import { describe, expect, it } from "vitest";
import { defineController, type ControllerClass } from "../src/index.js";

const define = (controller: unknown) => () => defineController(controller as ControllerClass);

describe("defineController (validação em runtime)", () => {
  it("devolve a própria classe", () => {
    class Ok {
      static route = { prefix: "/ok", actions: { ping: ["GET", "/"] } } as const;
      ping() {}
    }
    expect(defineController(Ok)).toBe(Ok);
  });

  it("rejeita valor que não é classe", () => {
    expect(define({ route: { prefix: "/x" } })).toThrow("controller must be a class");
  });

  it("rejeita `static route` ausente", () => {
    expect(define(class NoRoute {})).toThrow("NoRoute: missing `static route`");
  });

  it("rejeita prefix inválido", () => {
    expect(define(class A { static route = {}; })).toThrow("`route.prefix`");
    expect(define(class B { static route = { prefix: "x" }; })).toThrow("`route.prefix`");
  });

  it("rejeita resource não boolean", () => {
    expect(define(class A { static route = { prefix: "/a", resource: "yes" }; })).toThrow(
      "`route.resource` must be a boolean",
    );
  });

  it("rejeita action que não é método", () => {
    expect(
      define(class A { static route = { prefix: "/a", actions: { nope: ["GET", "/"] } }; }),
    ).toThrow('action "nope" is not a controller method');
  });

  it("rejeita tupla, verbo e path inválidos", () => {
    const withAction = (def: unknown) =>
      define(
        class A {
          static route = { prefix: "/a", actions: { go: def } };
          go() {}
        },
      );
    expect(withAction("GET /")).toThrow("must be a [method, path] tuple");
    expect(withAction(["GT", "/"])).toThrow('invalid method: "GT"');
    expect(withAction([[], "/"])).toThrow("invalid method: []");
    expect(withAction([["GET", "PUTS"], "/"])).toThrow('invalid method: ["GET","PUTS"]');
    expect(withAction(["GET", "x"])).toThrow('invalid path: "x"');
  });
});
