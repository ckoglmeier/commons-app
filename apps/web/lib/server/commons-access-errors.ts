export class CommonsAuthenticationRequiredError extends Error {
  constructor() {
    super("Sign in to continue.");
    this.name = "CommonsAuthenticationRequiredError";
  }
}

export class CommonsMembershipRequiredError extends Error {
  constructor() {
    super("You aren’t on this trip.");
    this.name = "CommonsMembershipRequiredError";
  }
}

/** Who can join on this copy refuses the signed-in account, so it has no Commons profile. Still a 403 wherever membership is handled. */
export class CommonsJoinRefusedError extends CommonsMembershipRequiredError {
  constructor(message: string) {
    super();
    this.message = message;
    this.name = "CommonsJoinRefusedError";
  }
}
