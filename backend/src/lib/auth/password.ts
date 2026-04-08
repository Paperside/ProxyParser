export const hashPassword = async (password: string) => {
  return Bun.password.hash(password, {
    algorithm: "argon2id"
  });
};

export const verifyPassword = async (password: string, passwordHash: string) => {
  return Bun.password.verify(password, passwordHash);
};
