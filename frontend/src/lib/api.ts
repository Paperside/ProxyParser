export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001").replace(
  /\/$/,
  ""
);

export const parseErrorMessage = async (response: Response) => {
  const text = await response.text();

  if (!text) {
    return `请求失败：${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { message?: string };
    return parsed.message ?? text;
  } catch {
    return text;
  }
};

export const requestJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return response.json() as Promise<T>;
};
