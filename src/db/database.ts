import mongoose from "mongoose";

import { DB_NAME } from "../constant.js";

import { apiError } from "../utils/apiError.js";

import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

export const connectDB = async () => {
try {


    const connect = await mongoose.connect(`${process.env.MONGO_DB_URI}/${DB_NAME}`)


    
} catch (error) {
    console.log(`database cant be connected ${error}`);
    process.exit(1)
    
}

}
