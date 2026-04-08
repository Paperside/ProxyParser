declare const Bun: {
  password: {
    hash(
      password: string,
      options?: {
        algorithm?: "argon2id" | "bcrypt";
      }
    ): Promise<string>;
    verify(password: string, hash: string): Promise<boolean>;
  };
};
