const fs = require('node:fs');
const path = require('node:path');

const [, , url, outputDir, ...args] = process.argv;
const videoId = new URL(url).searchParams.get('v');
const outputFormat = args[args.indexOf('--format') + 1] || 'mp3';
const bitrateIndex = args.indexOf('--bitrate');
const bitrate = bitrateIndex >= 0 ? Number(args[bitrateIndex + 1]) : null;

fs.mkdirSync(outputDir, { recursive: true });

if (videoId === 'bbbbbbbbbbb') {
    process.stderr.write('MUSIC_IDL_EVENT {"stage":"downloading","progress":10}\n');
    setInterval(() => {}, 1000);
} else if (videoId === 'ccccccccccc') {
    process.stderr.write('fixture failure\n');
    process.exitCode = 1;
} else {
    const extension = outputFormat === 'original' ? 'm4a' : 'mp3';
    const filePath = path.join(outputDir, `fixture [${videoId}].${extension}`);
    fs.writeFileSync(filePath, 'abc');
    process.stderr.write('ordinary fixture log\n');
    process.stderr.write('MUSIC_IDL_EVENT {"stage":"metadata","progress":2}\n');
    process.stderr.write('MUSIC_IDL_EVENT {"stage":"downloading","progress":62}\n');
    process.stdout.write(`${JSON.stringify({
        status: 'ok',
        file_path: filePath,
        format: extension,
        bitrate,
        file_size: 3
    })}\n`);
}
