const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { allowedAudioPath } = require('./download-options');

const EVENT_PREFIX = 'MUSIC_IDL_EVENT ';
const EVENT_STAGES = new Set(['metadata', 'downloading', 'encoding', 'tagging']);
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

function parseEngineEvent(line) {
    if (typeof line !== 'string' || !line.startsWith(EVENT_PREFIX)) return null;
    try {
        const event = JSON.parse(line.slice(EVENT_PREFIX.length));
        const progress = Number(event.progress);
        if (!EVENT_STAGES.has(event.stage) || !Number.isFinite(progress)) return null;
        return {
            stage: event.stage,
            progress: Math.max(0, Math.min(100, Math.round(progress)))
        };
    } catch {
        return null;
    }
}

function abortError() {
    const error = new Error('Download dibatalkan.');
    error.name = 'AbortError';
    return error;
}

function createEngineRunner({ binary, scriptPath, cwd, env, timeoutMs, outputDir }) {
    fs.mkdirSync(outputDir, { recursive: true });

    return function runEngine(job, signal, onProgress) {
        return new Promise((resolve, reject) => {
            const jobDir = fs.mkdtempSync(path.join(outputDir, 'job-'));
            if (signal.aborted) {
                fs.rmSync(jobDir, { recursive: true, force: true });
                reject(abortError());
                return;
            }

            const args = [
                scriptPath,
                job.url,
                jobDir,
                '--format',
                job.options.format
            ];
            if (job.options.format === 'mp3') {
                args.push('--bitrate', String(job.options.bitrate));
            }

            const child = spawn(binary, args, {
                cwd,
                env,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderrBuffer = '';
            let outputBytes = 0;
            let timedOut = false;
            let aborted = false;
            let settled = false;

            const removeJobDir = () => {
                fs.rmSync(jobDir, { recursive: true, force: true });
            };
            const finish = (error, result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                signal.removeEventListener('abort', onAbort);
                if (error) {
                    removeJobDir();
                    reject(error);
                } else {
                    resolve(result);
                }
            };
            const onAbort = () => {
                aborted = true;
                child.kill('SIGTERM');
            };
            const timer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGTERM');
            }, Math.max(1000, timeoutMs));
            timer.unref?.();
            signal.addEventListener('abort', onAbort, { once: true });

            child.stdout.on('data', chunk => {
                outputBytes += chunk.length;
                if (outputBytes > MAX_OUTPUT_BYTES) {
                    child.kill('SIGTERM');
                    return;
                }
                stdout += chunk.toString('utf8');
            });

            child.stderr.on('data', chunk => {
                outputBytes += chunk.length;
                if (outputBytes > MAX_OUTPUT_BYTES) {
                    child.kill('SIGTERM');
                    return;
                }
                stderrBuffer += chunk.toString('utf8');
                const lines = stderrBuffer.split(/\r?\n/);
                stderrBuffer = lines.pop() || '';
                for (const line of lines) {
                    const event = parseEngineEvent(line);
                    if (event) onProgress(event);
                }
            });

            child.once('error', error => finish(error));
            child.once('close', code => {
                const trailingEvent = parseEngineEvent(stderrBuffer);
                if (trailingEvent) onProgress(trailingEvent);
                if (aborted) return finish(abortError());
                if (timedOut) {
                    const error = new Error('Engine timeout');
                    error.code = 'DOWNLOAD_TIMEOUT';
                    return finish(error);
                }
                if (outputBytes > MAX_OUTPUT_BYTES) {
                    return finish(new Error('Engine output exceeded the limit'));
                }
                if (code !== 0) return finish(new Error(`Engine exited with code ${code}`));

                try {
                    const resultLine = stdout.trim().split('\n').filter(Boolean).at(-1);
                    const result = JSON.parse(resultLine);
                    const filePath = path.resolve(result.file_path);
                    if (result.status !== 'ok' || !allowedAudioPath(jobDir, filePath) || !fs.existsSync(filePath)) {
                        throw new Error('Engine returned an invalid audio path');
                    }
                    const extension = path.extname(filePath).slice(1).toLowerCase();
                    finish(null, {
                        filePath,
                        fileName: path.basename(filePath),
                        fileSize: fs.statSync(filePath).size,
                        outputFormat: extension,
                        bitrate: job.options.format === 'mp3' ? job.options.bitrate : null,
                        jobDir
                    });
                } catch (error) {
                    finish(error);
                }
            });
        });
    };
}

module.exports = { createEngineRunner, parseEngineEvent };
