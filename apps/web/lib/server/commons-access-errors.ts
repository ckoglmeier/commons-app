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
