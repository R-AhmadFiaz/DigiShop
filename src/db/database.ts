import mongoose from "mongoose";

import { DB_NAME } from "../constant.js";

import { apiError } from "../utils/apiError.js";


try {

    const connectDB = async () => {

    const connect = await mongoose.connect(`${process.env.MONGO_DB_URI}/${DB_NAME}`)


}
    
} catch (error) {
    throw new apiError(500, 'Database could not be connected')
}

