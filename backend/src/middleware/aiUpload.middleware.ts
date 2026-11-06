import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { open } from "node:fs/promises";
import type { RequestHandler } from "express";
import { apiError } from "../utils/apiError.js";

const formats: Record<string, string[]> = {
    ".webm": ["audio/webm", "video/webm"], ".m4a": ["audio/mp4", "audio/x-m4a"],
    ".mp4": ["audio/mp4", "video/mp4"], ".wav": ["audio/wav", "audio/x-wav", "audio/wave"],
    ".mp3": ["audio/mpeg", "audio/mp3"], ".ogg": ["audio/ogg", "application/ogg"],
};

const storage = multer.diskStorage({
    destination: "./public/temp",
    filename: (req, file, cb) => {
        cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
    }
});

export const aiUpload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, files: 1, fields: 1, fieldSize: 4000
    },
    fileFilter: (req, file, cb) => {
        if (!formats[path.extname(file.originalname).toLowerCase()]?.includes(file.mimetype.split(";")[0]!)) return cb(new apiError(400, "Use a supported audio recording (WebM, MP4, WAV, MP3 or OGG)."));
        cb(null, true);
    }
});

export const receiveAIInput: RequestHandler = (req, res, next) => {
    aiUpload.single("audio")(req, res, error => next(error ? new apiError(400, error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? "Recording must be smaller than 10 MB." : "Invalid audio upload. Send one supported recording or a text question.") : undefined));
};

export async function validateAudioFile(file: Express.Multer.File) {
    const handle = await open(file.path, "r");
    try {
        const buffer = Buffer.alloc(16);
        const {bytesRead} = await handle.read(buffer, 0, 16, 0);
        const extension = path.extname(file.originalname).toLowerCase();
        const valid = bytesRead >= 4 && (
            (extension === ".webm" && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) ||
            ([".mp4", ".m4a"].includes(extension) && buffer.toString("ascii", 4, 8) === "ftyp") ||
            (extension === ".wav" && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") ||
            (extension === ".ogg" && buffer.toString("ascii", 0, 4) === "OggS") ||
            (extension === ".mp3" && (buffer.toString("ascii", 0, 3) === "ID3" || (buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0)))
        );
        if (!valid) throw new apiError(400, "The recording is not valid audio. Please record again.");
    } finally { await handle.close(); }
}
