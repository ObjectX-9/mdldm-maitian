import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const inputFormats: Readonly<Record<string, string>> = {
  '.jpeg': 'jpeg_pipe', '.jpg': 'jpeg_pipe', '.png': 'png_pipe', '.webp': 'webp_pipe',
  '.gif': 'gif', '.mp4': 'mov', '.webm': 'matroska',
};
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

function executable(name: 'ffmpeg' | 'ffprobe') {
  const configured = process.env[name === 'ffmpeg' ? 'MAITIAN_FFMPEG' : 'MAITIAN_FFPROBE'];
  const homebrew = `/opt/homebrew/bin/${name}`;
  return configured || (process.platform === 'darwin' && existsSync(homebrew) ? homebrew : name);
}

export async function optimizeCreationMedia(directory: string, input: string, buffer: Buffer, extension: string, kind: 'image' | 'video') {
  const original = { file: input, extension, bytes: buffer.length };
  const inputArgs = ['-protocol_whitelist', 'file,pipe', '-f', inputFormats[extension]];
  const video = kind === 'video';
  try {
    if (video) {
      const { stdout } = await exec(executable('ffprobe'), [
        '-v', 'error', ...inputArgs, '-select_streams', 'v:0', '-show_entries', 'stream=codec_type,color_transfer', '-of', 'json', input,
      ], { timeout: 15_000 });
      const info = JSON.parse(stdout) as { streams?: { codec_type?: string; color_transfer?: string }[] };
      const stream = info.streams?.[0];
      if (stream?.codec_type !== 'video') throw new Error('文件中没有视频画面');
      if (stream.color_transfer === 'smpte2084' || stream.color_transfer === 'arib-std-b67') return original;
    } else if (
      (extension === '.gif' && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) ||
      (extension === '.png' && buffer.subarray(0, 8).equals(pngSignature) && buffer.includes('acTL')) ||
      (extension === '.webp' && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 16) === 'WEBPVP8X' && (buffer[20] & 2))
    ) {
      return original;
    }

    const outputExtension = video ? '.mp4' : '.webp';
    const output = path.join(directory, `optimized${outputExtension}`);
    const encoder = video
      ? ['-map', '0:v:0', '-map', '0:a:0?', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']
      : ['-frames:v', '1', '-c:v', 'libwebp', '-quality', '93', '-compression_level', '5', ...(extension === '.png' ? ['-lossless', '1'] : [])];
    await exec(executable('ffmpeg'), [
      '-v', 'error', '-nostdin', ...inputArgs, '-threads', '2', '-i', input, ...encoder, '-threads', '2', '-map_metadata', '-1', output,
    ], { timeout: 540_000 });
    const { size } = await stat(output);
    return size > 0 && size < original.bytes ? { file: output, extension: outputExtension, bytes: size } : original;
  } catch (failure) {
    const error = failure as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') throw Object.assign(new Error('服务端需要安装 FFmpeg 和 FFprobe 才能处理图片和视频'), { status: 503 });
    throw Object.assign(new Error(video ? '视频压缩失败，请检查文件能否正常播放' : '图片压缩失败，请检查原图格式', { cause: failure }), { status: 422 });
  }
}
