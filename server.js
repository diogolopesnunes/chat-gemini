import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";

const app = express();

const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const MAX_HISTORY_MESSAGES = 12;

// Verificação de segurança da chave de API
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

/**
 * Lê as instruções de personalidade do arquivo agente.txt
 */
function readAgentInstructions() {
    const agentPath = path.join(rootDir, "context", "agente.txt");
    
    if (fs.existsSync(agentPath)) {
        return fs.readFileSync(agentPath, "utf-8");
    }
    
    // Fallback caso o arquivo não exista
    return "Você é um assistente prestativo.";
}

/**
 * Lê todos os arquivos de dados na pasta context (exceto o agente.txt)
 */
function readTxtContext() {
    const contextDir = path.join(rootDir, "context");

    if (!fs.existsSync(contextDir)) return "";

    const files = fs
        .readdirSync(contextDir)
        .filter((file) => file.toLowerCase().endsWith(".txt") && file !== "agente.txt");

    const contents = files.map((file) => {
        const filePath = path.join(contextDir, file);
        const text = fs.readFileSync(filePath, "utf-8");

        return `--- INÍCIO DO ARQUIVO: ${file} ---\n${text}\n--- FIM DO ARQUIVO: ${file} ---`;
    });

    return contents.join("\n\n");
}

/**
 * Monta o prompt final combinando a pergunta e o conhecimento técnico
 */
function buildUserPrompt(userMessage, contextText) {
    return `
CONTEXTO DE DADOS DISPONÍVEL:
${contextText || "Nenhum dado adicional de contexto foi encontrado."}

PERGUNTA DO USUÁRIO:
${userMessage}

Lembre-se: Use o contexto acima para responder, seguindo suas diretrizes de agente.
`;
}

app.post("/api/chat", async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || typeof message !== "string") {
            return res.status(400).json({ error: "Mensagem inválida." });
        }

        // 1. Carrega as instruções do agente (Quem eu sou?)
        const systemInstruction = readAgentInstructions();

        // 2. Carrega o contexto de dados (O que eu sei?)
        const contextText = readTxtContext();

        // 3. Monta a estrutura de mensagens para o Gemini
        const contents = [
            ...history,
            {
                role: "user",
                parts: [{ text: buildUserPrompt(message, contextText) }],
            },
        ];

        const response = await ai.models.generateContent({
            model: MODEL,
            contents,
            config: {
                // Passamos o conteúdo do agente.txt aqui
                systemInstruction,
            },
        });

        const answer = response.text || "Não consegui gerar uma resposta.";

        // Atualiza o histórico para manter a memória da conversa
        history.push({ role: "user", parts: [{ text: message }] });
        history.push({ role: "model", parts: [{ text: answer }] });

        // Garante que o histórico não cresça infinitamente
        history = history.slice(-MAX_HISTORY_MESSAGES);

        return res.json({ answer });

    } catch (error) {
        console.error("Erro ao chamar Gemini API:", error);
        return res.status(500).json({ error: "Erro interno no servidor." });
    }
});

app.post("/api/reset", (req, res) => {
    history = [];
    return res.json({ message: "Histórico apagado." });
});

app.listen(PORT, () => {
    console.log(`🚀 Sr. RAG Online: http://localhost:${PORT}`);
});