import { type Request, type Response } from "express";
import OpenAI from "openai";
import fs from 'fs'

import { asyncHandler } from "../utils/asyncHandler.js";
import { apiError } from "../utils/apiError.js";
import { apiResponse } from "../utils/apiResponse.js";
import { Product } from "../models/product.model.js";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export const aiQuery = asyncHandler(async (req: Request, res: Response) => {

    const { shopId } = req.user;

    // 1. Check audio
    if (!req.file) {
        throw new apiError(400, "Audio file is required");
    }

    // 2. Convert voice → text
    const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(req.file.path) ,
        model: "gpt-4o-mini-transcribe",
    });

    const userText = transcription.text;

    console.log("User said:", userText);

    // 3. Convert text → structured AI intent
    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: {
            type: "json_object",
        },
        messages: [
            {
                role: "system",
                content: `
You are an assistant for an inventory system.

Understand Roman Urdu, Urdu, and English.

Return ONLY JSON.

Allowed actions:
- checkStock

For stock questions return:

{
    "action": "checkStock",
    "product": "product name"
}

Example:
User: "fan ka stock kitna hai?"
Return:
{
    "action": "checkStock",
    "product": "fan"
}
`,
            },
            {
                role: "user",
                content: userText,
            },
        ],
    });

    // 4. Parse AI result
    const aiResult = JSON.parse(
        completion.choices[0]!.message.content || "{}"
    );

    console.log("AI result:", aiResult);

    // 5. Validate action
    if (aiResult.action !== "checkStock") {
        throw new apiError(400, "Unsupported AI action");
    }

    if (!aiResult.product) {
        throw new apiError(400, "Product is required");
    }

    // 6. Search YOUR database
    const products = await Product.find({
        shopId,
        $or: [
            {
                name: {
                    $regex: aiResult.product,
                    $options: "i",
                },
            },
            {
                brand: {
                    $regex: aiResult.product,
                    $options: "i",
                },
            },
        ],
    }).select("name brand stockQuantity unit");

    // 7. Product not found
    if (products.length === 0) {
        throw new apiError(404, "Product not found");
    }

    // 8. Return result
    return res.status(200).json(
        new apiResponse(
            200,
            {
                action: aiResult.action,
                transcription: userText,
                products,
            },
            "AI query processed successfully"
        )
    );
});