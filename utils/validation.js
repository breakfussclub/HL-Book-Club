// utils/validation.js — Input Validation & Sanitization
// 🛡️ Centralized validation for all user inputs
// ✅ Type checking, range validation, sanitization
// ✅ Returns { valid: boolean, error: string, sanitized: value }

import { config } from "../config.js";

// ===== Validation Result Factory =====
function validResult(sanitized) {
  return { valid: true, error: null, sanitized };
}

function invalidResult(error) {
  return { valid: false, error, sanitized: null };
}

// ===== Page Number Validation =====
export function validatePageNumber(input, allowZero = true) {
  const num = Number(input);

  if (isNaN(num)) {
    return invalidResult("Page number must be a valid number");
  }

  if (!Number.isInteger(num)) {
    return invalidResult("Page number must be a whole number");
  }

  const min = allowZero ? config.validation.minPageNumber : 1;
  const max = config.validation.maxPageNumber;

  if (num < min) {
    return invalidResult(`Page number must be at least ${min}`);
  }

  if (num > max) {
    return invalidResult(`Page number cannot exceed ${max}`);
  }

  return validResult(num);
}

// ===== Text Field Validation =====
export function validateTitle(input) {
  if (!input || typeof input !== "string") {
    return invalidResult("Title is required");
  }

  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return invalidResult("Title cannot be empty");
  }

  if (trimmed.length > config.validation.maxTitleLength) {
    return invalidResult(`Title must be ${config.validation.maxTitleLength} characters or less`);
  }

  // Sanitize: remove control characters, normalize whitespace
  const sanitized = trimmed.replace(/[\x00-\x1F\x7F]/g, "").replace(/\s+/g, " ");

  return validResult(sanitized);
}

export function validateAuthor(input) {
  if (!input || typeof input !== "string") {
    return validResult("Unknown"); // Author is optional, provide default
  }

  const trimmed = input.trim();

  if (trimmed.length > config.validation.maxAuthorLength) {
    return invalidResult(`Author must be ${config.validation.maxAuthorLength} characters or less`);
  }

  const sanitized = trimmed.replace(/[\x00-\x1F\x7F]/g, "").replace(/\s+/g, " ");

  return validResult(sanitized || "Unknown");
}

export function validateQuote(input) {
  if (!input || typeof input !== "string") {
    return invalidResult("Quote text is required");
  }

  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return invalidResult("Quote cannot be empty");
  }

  if (trimmed.length > config.validation.maxQuoteLength) {
    return invalidResult(`Quote must be ${config.validation.maxQuoteLength} characters or less`);
  }

  const sanitized = trimmed.replace(/[\x00-\x1F\x7F]/g, "");

  return validResult(sanitized);
}

export function validateNotes(input) {
  if (!input || typeof input !== "string") {
    return validResult(""); // Notes are optional
  }

  const trimmed = input.trim();

  if (trimmed.length > config.validation.maxNotesLength) {
    return invalidResult(`Notes must be ${config.validation.maxNotesLength} characters or less`);
  }

  const sanitized = trimmed.replace(/[\x00-\x1F\x7F]/g, "");

  return validResult(sanitized);
}

export function validateSearchQuery(input) {
  if (!input || typeof input !== "string") {
    return invalidResult("Search query is required");
  }

  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return invalidResult("Search query cannot be empty");
  }

  if (trimmed.length > config.validation.maxSearchQueryLength) {
    return invalidResult(`Search query must be ${config.validation.maxSearchQueryLength} characters or less`);
  }

  const sanitized = trimmed.replace(/[\x00-\x1F\x7F]/g, "").replace(/\s+/g, " ");

  return validResult(sanitized);
}

// ===== ISBN Validation =====
export function validateISBN(input) {
  if (!input || typeof input !== "string") {
    return validResult(null); // ISBN is optional
  }

  const cleaned = input.replace(/[-\s]/g, "");

  // ISBN-10 or ISBN-13
  if (!/^(\d{10}|\d{13})$/.test(cleaned)) {
    return invalidResult("ISBN must be 10 or 13 digits");
  }

  return validResult(cleaned);
}

// ===== URL Validation =====
export function validateURL(input) {
  if (!input || typeof input !== "string") {
    return validResult(null); // URL is optional
  }

  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) {
      return invalidResult("URL must use http or https protocol");
    }
    return validResult(url.href);
  } catch {
    return invalidResult("Invalid URL format");
  }
}

// ===== User ID Validation =====
export function validateUserId(input) {
  if (!input || typeof input !== "string") {
    return invalidResult("User ID is required");
  }

  // Discord snowflake IDs are 17-19 digits
  if (!/^\d{17,19}$/.test(input)) {
    return invalidResult("Invalid user ID format");
  }

  return validResult(input);
}

// ===== Book ID Validation =====
export function validateBookId(input) {
  if (!input) {
    return invalidResult("Book ID is required");
  }

  const id = String(input);

  if (id.length === 0 || id.length > 100) {
    return invalidResult("Invalid book ID");
  }

  // Sanitize: remove path separators and control chars
  const sanitized = id.replace(/[\/\\]/g, "-").replace(/[\x00-\x1F\x7F]/g, "");

  return validResult(sanitized);
}

// ===== Progress Validation =====
export function validateProgress(currentPage, totalPages) {
  const current = validatePageNumber(currentPage, true);
  if (!current.valid) return current;

  if (!totalPages) {
    return validResult({ currentPage: current.sanitized, totalPages: null });
  }

  const total = validatePageNumber(totalPages, false);
  if (!total.valid) return total;

  if (current.sanitized > total.sanitized) {
    return invalidResult("Current page cannot exceed total pages");
  }

  return validResult({
    currentPage: current.sanitized,
    totalPages: total.sanitized,
  });
}

// ===== Batch Validation Helper =====
export function validateFields(fields) {
  const results = {};
  const errors = [];

  for (const [key, { validator, value }] of Object.entries(fields)) {
    const result = validator(value);
    results[key] = result;

    if (!result.valid) {
      errors.push(`${key}: ${result.error}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    results,
  };
}
