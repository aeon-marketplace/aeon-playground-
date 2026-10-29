import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(3, "Email is required.")
  .max(254, "Email is too long.")
  .email("Enter a valid email address.");

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(200, "Password is too long.");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(200),
});

export const chatRoleSchema = z.enum(["system", "user", "assistant"]);

export const chatMessageSchema = z.object({
  role: chatRoleSchema,
  content: z
    .string()
    .min(1, "Message cannot be empty.")
    .max(8000, "A single message cannot exceed 8,000 characters."),
});

export const chatSchema = z.object({
  modelRef: z.string().min(1).max(300),
  messages: z
    .array(chatMessageSchema)
    .min(1, "At least one message is required.")
    .max(30, "At most 30 messages are allowed.")
    .refine((messages) => messages.reduce((sum, message) => sum + message.content.length, 0) <= 30_000, {
      message: "Total conversation length cannot exceed 30,000 characters.",
    })
    .refine((messages) => messages[messages.length - 1]?.role === "user", {
      message: "The final message must be from the user.",
    }),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(1).max(4096).default(1024),
});

export const compareSchema = z.object({
  modelRefs: z
    .array(z.string().min(1).max(300))
    .min(2, "Choose at least two models.")
    .max(4, "Compare at most four models.")
    .refine((refs) => new Set(refs).size === refs.length, "Choose each model only once."),
  prompt: z.string().trim().min(1, "Prompt is required.").max(8000),
  systemPrompt: z.string().max(4000).optional().default(""),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(1).max(4096).default(1024),
});

export const imageSchema = z.object({
  modelRef: z.string().min(1).max(300),
  prompt: z.string().trim().min(1, "Prompt is required.").max(2000),
  negativePrompt: z.string().trim().max(1000).optional().default(""),
  width: z.number().int().min(256).max(1024).default(512),
  height: z.number().int().min(256).max(1024).default(512),
  count: z.number().int().min(1).max(1).default(1),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
});

export const modelTestSchema = z.object({
  modelRef: z.string().min(1).max(300),
  playground: z.enum(["text", "image"]).optional(),
});

export const providerKeySchema = z.object({
  providerId: z.string().min(1).max(50),
  apiKey: z
    .string()
    .trim()
    .min(8, "API key is too short.")
    .max(512, "API key is too long.")
    .regex(/^\S+$/, "API key cannot contain whitespace."),
});

export const customModelSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
  baseUrl: z.string().trim().min(1, "Base URL is required.").max(2048),
  modelId: z.string().trim().min(1, "Model ID is required.").max(300),
  apiKey: z
    .string()
    .trim()
    .max(512, "API key is too long.")
    .regex(/^\S*$/, "API key cannot contain whitespace.")
    .optional()
    .default(""),
});

export const customModelUpdateSchema = customModelSchema
  .extend({
    clearApiKey: z.boolean().optional().default(false),
  })
  .refine((value) => !(value.clearApiKey && value.apiKey.length > 0), {
    message: "Choose a replacement key or remove the saved key, not both.",
    path: ["clearApiKey"],
  });

export const settingsSchema = z.object({
  defaultModelRef: z.string().max(300).nullable().optional(),
  defaultSystemPrompt: z.string().max(4000).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(200),
});

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const providerTestSchema = z.object({
  providerId: z.string().min(1).max(50),
  refresh: z.boolean().optional().default(false),
});
