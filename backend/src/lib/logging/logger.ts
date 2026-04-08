type LogLevel = "info" | "warn" | "error";

type LogFieldValue = string | number | boolean | null | undefined | Record<string, unknown> | unknown[];

export interface LogFields {
  event: string;
  [key: string]: LogFieldValue;
}

const getConsoleMethod = (level: LogLevel) => {
  if (level === "error") {
    return console.error;
  }

  if (level === "warn") {
    return console.warn;
  }

  return console.log;
};

const normalizeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  return {
    message: String(error)
  };
};

const writeLog = (level: LogLevel, fields: LogFields) => {
  const method = getConsoleMethod(level);
  method(
    JSON.stringify({
      time: new Date().toISOString(),
      level,
      ...fields
    })
  );
};

export const logger = {
  info(fields: LogFields) {
    writeLog("info", fields);
  },
  warn(fields: LogFields) {
    writeLog("warn", fields);
  },
  error(fields: LogFields & { error?: unknown }) {
    const { error, ...rest } = fields;
    writeLog("error", {
      ...rest,
      error: error === undefined ? undefined : normalizeError(error)
    });
  }
};
