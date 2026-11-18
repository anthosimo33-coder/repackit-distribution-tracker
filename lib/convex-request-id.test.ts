import { describe, expect, it } from "vitest";
import { convexRequestId } from "./convex-request-id";

describe("convexRequestId", () => {
  it("lit le code d'une query en échec telle que le client Convex la rapporte", () => {
    const error = new Error(
      "[CONVEX Q(progression:getMyProgression)] [Request ID: 4f1c9a0be27d3355] Server Error\n  Called by client",
    );
    expect(convexRequestId(error)).toBe("4f1c9a0be27d3355");
  });

  it("rend null quand le message n'en porte pas", () => {
    expect(convexRequestId(new Error("Cannot read properties of undefined"))).toBeNull();
    expect(
      convexRequestId(new Error("[CONVEX Q(assignments:getMyAssignment)] Server Error")),
    ).toBeNull();
    expect(convexRequestId(undefined)).toBeNull();
    expect(convexRequestId({ message: "[Request ID: abc]" })).toBeNull();
  });

  it("accepte une chaîne brute", () => {
    expect(convexRequestId("[Request ID: abc123] Server Error")).toBe("abc123");
  });
});
