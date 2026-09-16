const path = require('node:path');
const { DownloadPolicyError } = require('./download-policy');

const MP3_BITRATES = new Set([128, 192, 320]);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.webm', '.opus']);

function normalizeDownloadOptions(value = {}) {
    const format = value && value.format !== undefined ? value.format : 'mp3';
    if (format === 'original') return { format, bitrate: null };

    const bitrate = value && value.bitrate !== undefined ? value.bitrate : 192;
    if (format !== 'mp3' || !MP3_BITRATES.has(bitrate)) {
        throw new DownloadPolicyError(
            'INVALID_OUTPUT_OPTIONS',
            'Format atau bitrate audio tidak didukung.',
            400
        );
    }
    return { format, bitrate };
}

function allowedAudioPath(jobDir, filePath) {
    if (typeof filePath !== 'string') return false;
    const resolvedJobDir = path.resolve(jobDir);
    const resolvedFile = path.resolve(filePath);
    const relative = path.relative(resolvedJobDir, resolvedFile);
    return Boolean(relative)
        && !relative.startsWith('..')
        && !path.isAbsolute(relative)
        && AUDIO_EXTENSIONS.has(path.extname(resolvedFile).toLowerCase());
}

module.exports = {
    AUDIO_EXTENSIONS,
    allowedAudioPath,
    normalizeDownloadOptions
};
