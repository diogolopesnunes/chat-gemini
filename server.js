import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";

const app = express();

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const MAX_HISTORY_MESSAGES = 12;

if (!process.env.GEMINI_API_KEY) {
    console.error("Erro: defina GEMINI_API_KEY no arquivo .env");
    process.exit(1);
}

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const rootDir = process.cwd();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(rootDir, "public")));

let history = [];

function readTxtContext() {
    const contextDir = path.join(rootDir, "context");

    if (!fs.existsSync(contextDir)) {
        return "";
    }

    const files = fs
        .readdirSync(contextDir)
        .filter((file) => file.toLowerCase().endsWith(".txt"));

    const contents = files.map((file) => {
        const filePath = path.join(contextDir, file);
        const text = fs.readFileSync(filePath, "utf-8");

        return `
--- INÍCIO DO ARQUIVO: ${file} ---

${text}

--- FIM DO ARQUIVO: ${file} ---
`;
    });

    return contents.join("\n\n");
}

function buildUserPrompt(userMessage, contextText) {
    return `
CONTEXTO DISPONÍVEL:

${contextText || "Nenhum arquivo TXT foi encontrado na pasta context."}

PERGUNTA DO USUÁRIO:

${userMessage}

INSTRUÇÕES:
- Responda em português brasileiro.
- Use o contexto acima como base principal.
- Se a resposta não estiver no contexto, diga claramente:
  "Não encontrei essa informação no material de contexto."
- Não invente dados.
- Seja direto e didático.
`;
}

app.post("/api/chat", async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || typeof message !== "string") {
            return res.status(400).json({
                error: "Mensagem inválida.",
            });
        }

        const contextText = readTxtContext();

        const systemInstruction = `
Você é um assistente particular que responde com base em arquivos TXT fornecidos como contexto.
Seu objetivo é ajudar o usuário de forma clara, objetiva e segura.
Não use informações externas quando a pergunta depender do material fornecido.
Quando não souber, diga que não encontrou a informação no contexto.
`;

        const contents = [
            ...history,
            {
                role: "user",
                parts: [
                    {
                        text: buildUserPrompt(message, contextText),
                    },
                ],
            },
        ];

        const response = await ai.models.generateContent({
            model: MODEL,
            contents,
            config: {
                systemInstruction,
            },
        });

        const answer = response.text || "Não consegui gerar uma resposta.";

        history.push({
            role: "user",
            parts: [{ text: message }],
        });

        history.push({
            role: "model",
            parts: [{ text: answer }],
        });

        history = history.slice(-MAX_HISTORY_MESSAGES);

        return res.json({
            answer,
        });
    } catch (error) {
        console.error("Erro ao chamar Gemini API:", error);

        // Handle quota exceeded error
        if (error?.message?.includes("429") || error?.message?.includes("RESOURCE_EXHAUSTED")) {
            return res.status(503).json({
                error: "Quota da API excedida. Verifique seu plano de faturamento ou aguarde o reset da cota.",
            });
        }

        return res.status(500).json({
            error: "Erro ao chamar Gemini API.",
        });
    }
});

app.post("/api/reset", (req, res) => {
    history = [];

    return res.json({
        message: "Histórico apagado.",
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Abra o navegador em: http://localhost:${PORT}`);
});