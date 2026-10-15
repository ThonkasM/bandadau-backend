import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FrameExtractorOptions {
  ffmpegPath: string;
  ffprobePath: string;
  intervalSeconds: number;
  maxFrames: number;
  timeoutMs: number;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error(`${cmd} timeout`));
    }, timeoutMs);
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${err.trim().slice(-300)}`));
    });
  });
}

/** ffprobe + ffmpeg via spawn (no shell). One JPEG (480 px wide) every `intervalSeconds`, at most `maxFrames`. Temp dir removed in `finally`. */
export class FfmpegFrameExtractor {
  constructor(private readonly o: FrameExtractorOptions) {}

  async withVideo<T>(video: Buffer, fn: (api: { durationSeconds: number; extractFrames(): Promise<Buffer[]> }) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'media-video-'));
    try {
      const input = join(dir, 'input.bin');
      await writeFile(input, video);
      const probe = await run(this.o.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', input], this.o.timeoutMs);
      const durationSeconds = Number.parseFloat(probe.trim());
      if (!Number.isFinite(durationSeconds)) throw new Error('ffprobe: no duration');
      return await fn({
        durationSeconds,
        extractFrames: async () => {
          await run(
            this.o.ffmpegPath,
            ['-v', 'error', '-nostdin', '-i', input, '-an', '-sn', '-vf', `fps=1/${this.o.intervalSeconds},scale=480:-2`, '-frames:v', String(this.o.maxFrames), '-q:v', '3', join(dir, 'frame_%03d.jpg')],
            this.o.timeoutMs,
          );
          const files = (await readdir(dir)).filter((f) => f.startsWith('frame_')).sort();
          return Promise.all(files.map((f) => readFile(join(dir, f))));
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
