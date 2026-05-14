type LogFields = Record<string, unknown>;

function emit(
  level: "info" | "warn" | "error",
  msg: string,
  fields: LogFields,
) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: "dashboard",
    msg,
    ...fields,
  };

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function logInfo(msg: string, fields: LogFields = {}) {
  emit("info", msg, fields);
}
