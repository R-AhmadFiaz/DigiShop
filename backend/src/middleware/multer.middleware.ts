import multer from "multer";
import path from "path";
import { type Request } from "express";
import { type FileFilterCallback } from "multer";

import { apiError } from "../utils/apiError.js";

// 1. Configure storage destination and filename formatting
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Files will be stored temporarily in public/temp
    cb(null, "./public/temp");
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const fileFilter = (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true)
  }
  else{
    cb(new apiError(400, 'Only Images types are allowed'))
  }
} 

// 2. Export configured multer middleware instance
export const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter
  
});