type Guard = (auth: { id: string; role: string }, route: { action: string }) => boolean | Promise<boolean>;
interface RC { readonly prefix: `/${string}`; readonly auth?: boolean | Guard; readonly public?: readonly string[] }

class A {
  static route = { prefix: "/a", auth: (auth, route) => auth.role === "admin" && route.action !== "x" } as const;
}
class B {
  static route = { prefix: "/a", auth: (auth, route) => auth.role === "admin" && route.action !== "x", public: ["index"] } as const satisfies RC;
  index() {}
}
const pub: readonly ["index"] = B.route.public;
export { A, B, pub };
