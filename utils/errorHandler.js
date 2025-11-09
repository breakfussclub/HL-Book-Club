// utils/errorHandler.js — Centralized Error Handling
// 🚨 Consistent error responses and logging
// ✅ User-friendly messages
// ✅ Detailed logging for debugging
// ✅ Interaction-safe error replies

import { config } from "../config.js";
import { logger } from "./logger.js";

// ===== Error Types =====
export const ErrorType = {
  VALIDATION: "VALIDATION",
  NOT_FOUND: "NOT_FOUND",
  PERMISSION: "PERMISSION",
  API: "API",
  DATABASE: "DATABASE",
  NETWORK: "NETWORK",
  DISCORD: "DISCORD",
  UNKNOWN: "UNKNOWN",
};

// ===== User-friendly Error Messages =====
const ERROR_MESSAGES = {
  [ErrorType.VALIDATION]: "❌ Invalid input. Please check your data and try again.",
  [ErrorType.NOT_FOUND]: "🔍 Not found. The requested item doesn't exist.",
  [ErrorType.PERMISSION]: "🔒 You don't have permission to do that.",
  [ErrorType.API]: "🌐 External service unavailable. Please try again later.",
  [ErrorType.DATABASE]: "💾 Database error. Please try again.",
  [ErrorType.NETWORK]: "📡 Network error. Please check your connection.",
  [ErrorType.DISCORD]: "⚠️ Discord API error. Please try again.",
  [ErrorType.UNKNOWN]: "⚠️ Something went wrong. Please try again.",
};

// ===== Custom Error Class =====
export class BotError extends Error {
  constructor(type, message, details = {}) {
    super(message);
    this.name = "BotError";
    this.type = type;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  getUserMessage() {
    return ERROR_MESSAGES[this.type] || ERROR_MESSAGES[ErrorType.UNKNOWN];
  }

  getLogMessage() {
    return `[${this.type}] ${this.message}${
      Object.keys(this.details).length > 0
        ? ` | Details: ${JSON.stringify(this.details)}`
        : ""
    }`;
  }
}

// ===== Handle Interaction Errors =====
export async function handleInteractionError(interaction, error, context = {}) {
  // Log the error
  const errorInfo = {
    user: interaction.user?.username || "Unknown",
    userId: interaction.user?.id || "Unknown",
    command: interaction.commandName || interaction.customId || "Unknown",
    type: error.type || ErrorType.UNKNOWN,
    message: error.message,
    ...context,
  };

  logger.error("Interaction error", errorInfo);

  // Get user-friendly message
  let userMessage;
  if (error instanceof BotError) {
    userMessage = error.getUserMessage();
    if (error.details.userMessage) {
      userMessage = error.details.userMessage;
    }
  } else {
    userMessage = ERROR_MESSAGES[ErrorType.UNKNOWN];
  }

  // Add debug info if enabled
  if (config.debug.enabled && error.stack) {
    logger.debug("Error stack trace", { stack: error.stack });
  }

  // Send error response to user
  try {
    const payload = {
      content: userMessage,
      flags: 1 << 6, // Ephemeral
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
    } else if (interaction.isModalSubmit() || interaction.isButton() || interaction.isStringSelectMenu()) {
      await interaction.reply(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (replyError) {
    logger.error("Failed to send error response", {
      originalError: error.message,
      replyError: replyError.message,
    });
  }
}

// ===== Safe Async Wrapper for Commands =====
export function safeExecute(commandFn) {
  return async (interaction) => {
    try {
      await commandFn(interaction);
    } catch (error) {
      await handleInteractionError(interaction, error, {
        command: interaction.commandName,
      });
    }
  };
}

// ===== Safe Async Wrapper for Component Handlers =====
export function safeHandleComponent(handlerFn) {
  return async (interaction) => {
    try {
      await handlerFn(interaction);
    } catch (error) {
      await handleInteractionError(interaction, error, {
        component: interaction.customId,
      });
    }
  };
}

// ===== Common Error Factories =====
export function validationError(message, details = {}) {
  return new BotError(ErrorType.VALIDATION, message, {
    userMessage: `❌ ${message}`,
    ...details,
  });
}

export function notFoundError(resource, details = {}) {
  return new BotError(ErrorType.NOT_FOUND, `${resource} not found`, {
    userMessage: `🔍 ${resource} not found.`,
    ...details,
  });
}

export function apiError(service, details = {}) {
  return new BotError(ErrorType.API, `${service} API error`, {
    userMessage: `🌐 ${service} is currently unavailable. Please try again later.`,
    ...details,
  });
}

export function databaseError(operation, details = {}) {
  return new BotError(ErrorType.DATABASE, `Database ${operation} failed`, {
    userMessage: "💾 Database error. Please try again.",
    ...details,
  });
}

// ===== Error Recovery Utilities =====
export async function retryAsync(fn, maxRetries = 3, delayMs = 1000) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      logger.warn(`Attempt ${attempt}/${maxRetries} failed`, {
        error: error.message,
      });

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError;
}

// ===== Global Error Handler =====
export function setupGlobalErrorHandlers() {
  // Unhandled promise rejections
  process.on("unhandledRejection", (error, promise) => {
    logger.error("Unhandled promise rejection", {
      error: error.message,
      stack: error.stack,
    });
  });

  // Uncaught exceptions
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", {
      error: error.message,
      stack: error.stack,
    });

    // Give logger time to flush
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    logger.info("SIGTERM received, shutting down gracefully");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    logger.info("SIGINT received, shutting down gracefully");
    process.exit(0);
  });
}
