/**
 * 上传音乐的压缩管线（和图片那条 tools/images/optimize.mjs 是一个路子）。
 *
 * 为什么要它：用户传的是 320kbps 的原盘 mp3，一首 8MB。手机上光是一首歌
 * 就等于把整页图片的流量再翻一倍，页面自然"加载很慢"。
 * 这里统一转成 **128kbps mp3**：约 3MB/首（小 2.5 倍），做背景音乐听不出差别。
 *
 * 用的是纯 JS/WASM 的两个小包（不下载平台二进制，pnpm install 即可复现）：
 *   mpg123-decoder        mp3 -> Float32 PCM（WASM，快）
 *   @breezystack/lamejs   PCM -> mp3（LAME 的 JS 版，128kbps CBR）
 * WAV（16bit PCM）也能吃，自己解个 RIFF 头就行。
 *
 * 两条重要规矩：
 *   1. **幂等**：源文件码率已经 ≤ 150kbps 就直接跳过 —— 有损格式反复编码只会越来越糊，
 *      所以重复上传/重复跑这个脚本不会二次损伤，也不会浪费电。
 *   2. **只在更小的时候替换**：编出来反而更大（极少数）就留着原文件。
 *      替换走"写临时文件 + rename"，中途失败不会留下半个坏文件。
 *
 * 用法：
 *   node tools/audio/optimize.mjs             压缩 public/audio/uploads 下所有音频
 *   node tools/audio/optimize.mjs <文件...>   只压指定文件
 * 编辑器上传时也会调这里的 compressAudio()，所以"之后上传的"同样自动压。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, '..', '..');
export const AUDIO_DIR = path.join(PROJECT_ROOT, 'public', 'audio', 'uploads');
const MUSIC_FILE = path.join(PROJECT_ROOT, 'src', 'data', 'music.json');

/** 目标码率：网页背景音乐的通用档位 */
export const TARGET_KBPS = 128;
/** 已经比这还省的就不动了（有损再压一遍只会更糊） */
const SKIP_BELOW_KBPS = 150;

/** lamejs 支持的采样率，别的得先重采样，这里直接跳过并说明 */
const LAME_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);

const AUDIO_EXT = new Set(['.mp3', '.wav']);

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + 'MB';
}

/** 解析 16bit PCM 的 WAV（常见的导出格式），别的位深直接说不支持 */
function decodeWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是 WAV 文件');
  }
  let pos = 12;
  let fmt = null;
  let dataStart = -1;
  let dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14)
      };
    } else if (id === 'data') {
      dataStart = body;
      dataLen = Math.min(size, buf.length - body);
      break;
    }
    pos = body + size + (size % 2);
  }
  if (!fmt || dataStart < 0) throw new Error('WAV 结构不完整');
  if (fmt.format !== 1 || fmt.bits !== 16) {
    throw new Error(`只支持 16bit PCM 的 WAV（这份是 format=${fmt.format} bits=${fmt.bits}）`);
  }
  const frames = Math.floor(dataLen / (fmt.channels * 2));
  const channelData = [];
  for (let c = 0; c < fmt.channels; c++) channelData.push(new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      channelData[c][i] = buf.readInt16LE(dataStart + (i * fmt.channels + c) * 2) / 32768;
    }
  }
  return { channelData, sampleRate: fmt.sampleRate, samplesDecoded: frames, errors: [] };
}

/** mp3 -> PCM（WASM 解码，快） */
async function decodeMp3(buf) {
  const { MPEGDecoder } = await import('mpg123-decoder');
  const decoder = new MPEGDecoder({ enableGapless: true });
  await decoder.ready;
  try {
    return decoder.decode(new Uint8Array(buf));
  } finally {
    decoder.free();
  }
}

/** 多声道先混成单/双声道（lamejs 只吃 1 或 2 声道） */
function toStereoTracks(channelData) {
  const n = channelData[0].length;
  if (channelData.length === 1) return [channelData[0], null];
  if (channelData.length === 2) return [channelData[0], channelData[1]];
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let l = 0;
    let r = 0;
    for (let c = 0; c < channelData.length; c++) {
      if (c % 2 === 0) l += channelData[c][i];
      else r += channelData[c][i];
    }
    left[i] = l / Math.ceil(channelData.length / 2);
    right[i] = r / Math.floor(channelData.length / 2);
  }
  return [left, right];
}

function floatToInt16(src) {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = src[i] < -1 ? -1 : src[i] > 1 ? 1 : src[i];
    out[i] = v < 0 ? v * 32768 : v * 32767;
  }
  return out;
}

/**
 * 压一个音频文件（原地替换，幂等）。
 * 返回 { ok, skipped, reason, before, after, kbpsBefore, kbpsAfter }
 */
export async function compressAudio(file, opts = {}) {
  const kbps = opts.kbps || TARGET_KBPS;
  const ext = path.extname(file).toLowerCase();
  const before = (await fsp.stat(file)).size;

  if (!AUDIO_EXT.has(ext)) {
    return { ok: false, skipped: true, reason: `${ext || '未知格式'} 暂不自动压缩（建议传 mp3）`, before, after: before };
  }

  const buf = await fsp.readFile(file);
  let pcm;
  try {
    pcm = ext === '.mp3' ? await decodeMp3(buf) : decodeWav(buf);
  } catch (err) {
    return { ok: false, skipped: true, reason: `解码失败：${err.message}`, before, after: before };
  }

  const { sampleRate, samplesDecoded } = pcm;
  const seconds = samplesDecoded / sampleRate;
  if (!(seconds > 0)) {
    return { ok: false, skipped: true, reason: '解出来是空的', before, after: before };
  }
  const kbpsBefore = Math.round((before * 8) / seconds / 1000);
  if (kbpsBefore <= SKIP_BELOW_KBPS) {
    return {
      ok: true,
      skipped: true,
      reason: `已经是 ${kbpsBefore}kbps，不用再压`,
      before,
      after: before,
      kbpsBefore,
      kbpsAfter: kbpsBefore
    };
  }
  if (!LAME_RATES.has(sampleRate)) {
    return {
      ok: false,
      skipped: true,
      reason: `采样率 ${sampleRate}Hz 不在编码器支持范围内`,
      before,
      after: before,
      kbpsBefore
    };
  }

  const [left, right] = toStereoTracks(pcm.channelData);
  const channels = right ? 2 : 1;
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const encoder = new Mp3Encoder(channels, sampleRate, kbps);

  const parts = [];
  const STEP = 1152 * 16; // 一次多喂点，快很多
  for (let i = 0; i < left.length; i += STEP) {
    const end = Math.min(i + STEP, left.length);
    const chunk = encoder.encodeBuffer(floatToInt16(left.subarray(i, end)), right ? floatToInt16(right.subarray(i, end)) : undefined);
    if (chunk.length) parts.push(Buffer.from(chunk));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(Buffer.from(tail));
  const out = Buffer.concat(parts);

  if (!out.length) {
    return { ok: false, skipped: true, reason: '编码结果为空', before, after: before, kbpsBefore };
  }
  // 只有真的更小才替换
  if (out.length >= before) {
    return {
      ok: true,
      skipped: true,
      reason: `压出来 ${mb(out.length)} 不比原来小，保留原文件`,
      before,
      after: before,
      kbpsBefore,
      kbpsAfter: kbpsBefore
    };
  }

  const tmp = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, out);
  await fsp.rename(tmp, file);
  return {
    ok: true,
    skipped: false,
    reason: `${kbpsBefore}kbps → ${kbps}kbps`,
    before,
    after: out.length,
    kbpsBefore,
    kbpsAfter: kbps
  };
}

/** 把 src/data/music.json 里各曲目的 bytes 按磁盘实际情况刷新（压缩后体积变了） */
async function syncMusicBytes() {
  if (!fs.existsSync(MUSIC_FILE)) return 0;
  const raw = await fsp.readFile(MUSIC_FILE, 'utf8');
  const data = JSON.parse(raw);
  let changed = 0;
  for (const track of data.tracks || []) {
    if (!track || typeof track.src !== 'string') continue;
    const rel = track.src.replace(/^\/+/, '');
    const abs = path.join(PROJECT_ROOT, 'public', rel);
    if (!fs.existsSync(abs)) continue;
    const size = fs.statSync(abs).size;
    if (track.bytes !== size) {
      track.bytes = size;
      changed++;
    }
  }
  if (changed) await fsp.writeFile(MUSIC_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return changed;
}

/** 扫描整个上传目录并压缩（编辑器插完文件也可以直接调） */
export async function optimizeAllAudio(dir = AUDIO_DIR) {
  if (!fs.existsSync(dir)) return { done: [], skipped: [], saved: 0, total: 0 };
  const files = fs
    .readdirSync(dir)
    .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => path.join(dir, f));
  const done = [];
  const skipped = [];
  let saved = 0;
  let total = 0;
  for (const file of files) {
    total += 1;
    const r = await compressAudio(file);
    if (r.skipped) skipped.push({ file, ...r });
    else {
      done.push({ file, ...r });
      saved += r.before - r.after;
    }
  }
  const synced = await syncMusicBytes();
  return { done, skipped, saved, total, synced };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).endsWith('optimize.mjs');
if (invokedDirectly) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (args.length) {
    let saved = 0;
    for (const f of args) {
      const abs = path.resolve(f);
      const r = await compressAudio(abs);
      console.log(
        `${path.basename(abs)}  ${mb(r.before)} → ${mb(r.after)}  ${r.skipped ? '跳过（' + r.reason + '）' : r.reason}`
      );
      saved += r.before - r.after;
    }
    const synced = await syncMusicBytes();
    console.log(`共省下 ${mb(saved)}；music.json 里刷新了 ${synced} 条体积`);
  } else {
    const t0 = Date.now();
    const res = await optimizeAllAudio();
    for (const d of res.done) {
      console.log(`压缩 ${path.basename(d.file)}  ${mb(d.before)} → ${mb(d.after)}  (${d.reason})`);
    }
    for (const s of res.skipped) {
      console.log(`跳过 ${path.basename(s.file)}  ${mb(s.before)}  (${s.reason})`);
    }
    console.log(
      `\n处理 ${res.total} 个文件：压了 ${res.done.length} 个、跳过 ${res.skipped.length} 个，` +
        `共省 ${mb(res.saved)}，music.json 刷新 ${res.synced} 条，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`
    );
  }
}
