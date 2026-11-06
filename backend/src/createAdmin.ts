import "dotenv/config";

import { connectDB } from "./db/database.js";
import { User } from "./models/user.model.js";

const createAdmin = async () => {
    try {
        await connectDB();

        const existingAdmin = await User.findOne({
            role: "ADMIN"
        });

        if (existingAdmin) {
            console.log("Admin already exists:", existingAdmin.email);
            return;
        }

        const admin = await User.create({
            username: process.env.ADMIN_USERNAME!,
            email: process.env.ADMIN_EMAIL!,
            password: process.env.ADMIN_PASSWORD!,
            role: "ADMIN"
        });

        console.log("Admin created successfully:", admin.email);

    } catch (error) {
        console.error("Failed to create admin:", error);
    }
};

createAdmin();