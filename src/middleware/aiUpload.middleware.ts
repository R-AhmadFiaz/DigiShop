import multer from "multer";

const storage = multer.diskStorage({
    destination: "./public/temp",
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

export const aiUpload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    }
});