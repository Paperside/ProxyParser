import { createOpaqueToken, hashOpaqueToken } from "../../lib/auth/tokens";
import { UserRepository } from "../users/user.repository";
import { SubscriptionAccessRepository } from "../subscriptions/subscription-access.repository";

export class SettingsError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export class SettingsService {
  constructor(
    private readonly users: UserRepository,
    private readonly accessRepository: SubscriptionAccessRepository
  ) {}

  rotateSubscriptionSecret(userId: string) {
    const user = this.users.findById(userId);

    if (!user) {
      throw new SettingsError("用户不存在。", 404);
    }

    const secret = createOpaqueToken(48);
    this.accessRepository.rotateUserSecret(userId, hashOpaqueToken(secret));

    return {
      secret
    };
  }
}
