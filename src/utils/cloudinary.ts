import { v2 as cloudinary } from "cloudinary";
import fs from "fs";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

export const uploadOnCloudinary = async (localFilePath: string) => {
  try {
    if (!localFilePath) return null;

    // 1. Upload the file from ./public/temp to Cloudinary
    const response = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "auto",
    });

    // 2. Remove local file from ./public/temp after successful upload
    fs.unlinkSync(localFilePath);
    
    return response;
  } catch (error) {
    // 3. Remove local file if upload failed to prevent accumulation of temporary files
      console.log(error);
      
      fs.unlinkSync(localFilePath);
    
    return null;
  }
};