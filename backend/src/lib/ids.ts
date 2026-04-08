import { randomUUID } from "node:crypto";

export const createId = (prefix: string) => {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
};
