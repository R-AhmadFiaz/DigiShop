import multer from "multer";
import path from "path";

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

// 2. Export configured multer middleware instance
export const upload = multer({ 
  storage,
  
});