# nextroller

Biblioteca de controllers para o route handler do Next.js App Router.
Um único catch-all `app/api/[[...path]]/route.ts` delega todas as requests para a lib, que despacha para métodos de classes controller.
Rotas são declaradas no próprio controller, via propriedade estática `route`. Não existe arquivo de rotas.

Construída sobre Hono (motor de roteamento interno) e Zod (validação).

## O que a lib entrega

- `defineController(Classe)`: valida e tipa a config `static route` do controller
- `createHandler({ controllers, ... })`: registra controllers e devolve `{ GET, POST, PUT, PATCH, DELETE }` para exportar no `route.ts`
- controllers como classes com métodos (`index`, `show`, `store`, `update`, `destroy` + métodos livres)
- `HttpContext` simples (auth, params, query, headers, validate, response helpers)
- validação com Zod dentro do controller
- autenticação declarada no controller (`auth` + `public`), com verificação delegada ao `authenticate` do app e regra opcional por controller (`auth` como função)
- tratamento central de erros

## Fora de escopo

Não adicionar sem pedido explícito:

- estratégia de autenticação (token, sessão, OAuth, cookies): fica no `authenticate` do app
- autorização que depende do recurso (dono, params, dados do banco): fica no service (`HTTPException(403)`)
- guards nomeados / lista de guards por ação: regra por controller é uma única função em `route.auth`
- decorators / `reflect-metadata`
- middlewares nomeados / kernel
- views, ORM, acesso a banco
- documentação OpenAPI
- client tipado ponta a ponta
- arquivo central de rotas / `group()` / handlers inline

## Estrutura do repositório

```
src/
  index.ts          # exports públicos
  context.ts        # createContext, HttpContext, Register
  controller.ts     # defineController, ControllerClass, Route, validação de route
  handler.ts        # createHandler: registro, ordenação, conflitos, onError
  errors.ts         # RouteNotFoundError, MethodNotAllowedError, UnauthorizedError, ForbiddenError
  cli/
    index.ts        # bin `nextroller`: parse de argv e comandos
    templates.ts    # templates do make:module
tests/              # testes da lib
examples/next-app/  # app Next de exemplo consumindo a lib
```

## Dependências

- `hono`: dependency. Detalhe de implementação, não vaza na API pública (exceto `ctx.raw` e `HTTPException`, reexportado pela lib e base de `RouteNotFoundError`/`MethodNotAllowedError`/`UnauthorizedError`/`ForbiddenError`).
- `zod`: **peerDependency**. Schemas do usuário e o `instanceof z.ZodError` do handler precisam usar a mesma cópia do zod.
- `chalk`: dependency, usado **só pelo CLI** (cores da saída). O runtime nunca importa `chalk`: logs de servidor seguem sem ANSI e o bundle serverless não carrega a dependência.
- `next`: não é importado pela lib. `createHandler()` trabalha só com `Request` / `Response` da Web API.

## Princípios de design

- **Não brigar com o roteamento do Next.** Usuário cria um único `app/api/[[...path]]/route.ts`. Toda integração com o Next fica isolada em `createHandler()`.
- **Rotas moram no controller.** `static route` é a única fonte de verdade das rotas de um controller.
- **Tipagem concentrada no `defineController`.** TypeScript não exige membros `static` via `implements`; a checagem acontece no parâmetro de `defineController`, tipado contra `ControllerClass` + `CheckActions` + `CheckPublic`. `static route` é anotado com `: Route<Controller>` (padrão) ou declarado com `as const`.
- **Sem estado global.** Nenhum singleton na lib; cada `createHandler()` monta seu próprio app Hono.
- **`HttpContext` é objeto, não classe.** Permite desestruturar (`{ params, validate }`) sem perder `this`.
- **O retorno do controller define a resposta:**
  - objeto/valor → `200` JSON
  - `undefined` → `204` sem corpo
  - `Response` → retornado como está (gerado via `ctx.response.*`)
- **Controllers importados estaticamente e instanciados por request.** Sem import lazy (necessário para ler `static route`; no catch-all todos os controllers já estão no mesmo bundle). Sem estado compartilhado entre requests.
- **Dependência pesada via `import()` dentro do método**, nunca no topo do controller/service. Protege o cold start sem precisar de lazy no router.
- **DI via parâmetro default no construtor:** `constructor(private users = new UsersService()) {}`. Em teste, passar fake no construtor.
- **Auth declarado no controller, verificado pelo app.** `static route` diz quais ações exigem usuário (`auth` + `public`) e, opcionalmente, quem pode entrar (`auth` como função); `createHandler({ authenticate })` diz como resolver o usuário. A lib nunca lê token, cookie ou sessão.
- **Controllers não usam try/catch para validação.** `ZodError` vira 422 no handler central.
- **Erros de configuração falham na inicialização**, não na request.
- **API pública pequena.** Cada export novo é contrato a manter.

## API pública

### `static route` + `defineController`

```ts
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Path = `/${string}`;
export type ActionDef = readonly [Method | readonly Method[], Path]; // ["GET", "/me"] ou [["PUT", "PATCH"], "/:id"]

// T = classe do controller. Sem T (any), nomes de ação viram `string`.
export interface AuthRoute<T = any> {
  readonly controller: string;       // nome da classe
  readonly action: ActionName<T>;    // método do controller ("index" | "show" | ... com T)
  readonly method: Method;           // verbo da request
  readonly path: string;             // path registrado completo, ex.: "/api/v1/orders/:id/approve"
}

// método (bivariante) para que AuthGuard<Controller> seja aceito onde se espera AuthGuard
export type AuthGuard<T = any> = {
  bivarianceHack(auth: AuthData, route: AuthRoute<T>): boolean | Promise<boolean>;
}["bivarianceHack"];

export interface Route<T = any> {
  readonly prefix: Path;                   // prefixo de todas as rotas do controller
  readonly resource?: boolean;             // gera CRUD para index/show/store/update/destroy que existirem
  readonly actions?: ActionMap<T>;         // { metodo: [verbo, path] }; com T, só métodos públicos
  readonly auth?: boolean | AuthGuard<T>;  // true/função: todas as ações exigem usuário autenticado
  readonly public?: readonly ActionName<T>[]; // ações liberadas de `auth` (exige `auth` true ou função)
}

export interface ControllerClass {
  new (...args: any[]): object;
  readonly route: Route;
}

export function defineController<C extends ControllerClass>(
  controller: C & CheckActions<C> & CheckPublic<C>,
): C;
```

Tipos auxiliares (internos):

```ts
type IsAny<T> = 0 extends 1 & T ? true : false;
type ActionName<T> = IsAny<T> extends true ? string : Methods<T>;
type ActionMap<T> = IsAny<T> extends true
  ? { readonly [action: string]: ActionDef }
  : [Methods<T>] extends [never]
    ? { readonly [action: string]: never }          // sem método público: nenhuma action aceita
    : { readonly [K in Methods<T>]?: ActionDef };

// métodos públicos da instância
type Methods<T> = { [K in keyof T]: T[K] extends (...a: any[]) => any ? K : never }[keyof T] & string;
type ActionsOf<C> = C extends { route: { actions: infer A } } ? A : {};

// chave de `actions` que não é método público vira `never` → erro de compilação
type CheckActions<C extends ControllerClass> = {
  route: { actions?: { [K in Exclude<keyof ActionsOf<C>, Methods<InstanceType<C>>>]: never } };
};

// com `public`: exige `auth` true ou função e só aceita métodos públicos
type CheckPublic<C extends ControllerClass> = HasPublic<C> extends true
  ? { route: { auth: true | AuthGuard; public: readonly Methods<InstanceType<C>>[] } }
  : {};
```

Regras de `route`:

- **Padrão: `static route: Route<UsersController> = { ... }`** (usado no exemplo, na documentação e no `make:module`). O genérico é a própria classe (referência de tipo dentro da classe, sem ciclo: o tipo da instância não inclui membros `static`). A anotação checa:
  - verbo, path e `prefix`;
  - chaves de `actions` e itens de `public` contra os métodos públicos da classe (erro com "Did you mean 'index'?");
  - retorno da função de `auth`, cujos parâmetros `(auth, route)` ganham tipo sem anotação, com `route.action` como união dos métodos.
- **`Route` sem genérico** (`static route: Route = {...}`) também compila, mas alarga nomes de ação para `string`: ação inexistente vira erro de runtime no `defineController` (no import do módulo), não de compilação.
- **Alternativa: `static route = { ... } as const`** (ou `as const satisfies Route` quando `auth` é função inline sem tipos). Preserva literais; nomes checados por `CheckActions`/`CheckPublic`.
- Com `Route<Controller>`, `CheckActions`/`CheckPublic` não atuam (a anotação já checou). Só `public` sem `auth` fica para o runtime do `defineController`.
- Sem anotação e sem `as const`, o TS alarga `["GET", "/me"]` para `string[]` e o `defineController` rejeita (erro de compilação). Nunca passa silenciosamente.
- Ações são tuplas `[verbo, path]`; vários verbos: `[["PUT", "PATCH"], path]`.
- `as const` preserva paths literais em `actions` (base para checar `HttpContext<P>` contra o `route` no futuro; com anotação `: Route<...>`, os paths viram `Path` e essa checagem não teria literais).
- `actions` sobrescreve `resource` quando o mesmo método aparece nos dois.
- Métodos `private` não podem ser rota (ficam fora de `keyof`). Helpers internos do controller devem ser `private`.
- Paths de `actions` são relativos ao `prefix`.
- `auth: true` protege todas as ações do controller; `public: [...]` lista exceções. Opt-in: controller sem `auth` (ou `auth: false`) é público.
- `auth` como função também protege todas as ações e acrescenta uma regra do controller (ver "Autenticação").
- `public` só aceita ações roteadas do controller (de `actions` ou geradas por `resource`) e exige `auth` true ou função.

Onde cada erro é pego:

| erro                                                     | quando                                 |
| -------------------------------------------------------- | -------------------------------------- |
| `static route` ausente ou sem `prefix`                   | compile time (`defineController`)      |
| nem anotação nem `as const`                              | compile time (`defineController`)      |
| verbo inválido (`["GT", "/me"]`), path/prefix sem `/` inicial | compile time (anotação ou `defineController`) |
| `auth` como função que não devolve `boolean`             | compile time (anotação ou `defineController`) |
| `auth` como função inline sem contexto (`as const` sem `satisfies Route`, sem tipos nos parâmetros) | compile time (`implicit any`) |
| chave de `actions` não é método público                  | compile time com `Route<Controller>` ou `as const`; runtime com `Route` sem genérico |
| `public` com método inexistente/privado                  | compile time com `Route<Controller>` ou `as const`; runtime com `Route` sem genérico |
| `public` sem `auth` (true/função)                        | compile time com `as const` (`CheckPublic`); runtime no `defineController` com anotação |
| `public` com método que não é rota                       | runtime, no `defineController`         |
| rota duplicada entre controllers                         | runtime, no `createHandler`            |
| `auth` (true/função) sem `authenticate` no `createHandler` | runtime, no `createHandler`          |

`defineController` também valida o formato em runtime (barato; cobre consumidores JS e casts `any`).

Resource routes (relativas ao `prefix`):

| método do controller | verbo      | path   |
| -------------------- | ---------- | ------ |
| `index`              | GET        | `/`    |
| `store`              | POST       | `/`    |
| `show`               | GET        | `/:id` |
| `update`             | PUT, PATCH | `/:id` |
| `destroy`            | DELETE     | `/:id` |

### `createHandler`

```ts
createHandler({
  controllers: ControllerClass[], // lista explícita de controllers
  basePath?: string,              // default "/api" (onde o catch-all está montado)
  prefix?: string,                // prefixo global, ex.: "/v1"
  authenticate?: Authenticate,    // resolve o usuário das rotas com `auth` (ver "Autenticação")
  onError?: ErrorHook,            // hook de erro customizável (ver abaixo)
}) => { GET, POST, PUT, PATCH, DELETE }

type Authenticate = (
  request: Request,
) => AuthData | null | undefined | Promise<AuthData | null | undefined>;

type ErrorHook = (
  err: unknown,
  request: Request,
) => Response | void | Promise<Response | void>;
```

Responsabilidades:

- montar rotas de todos os controllers (`basePath + prefix + route.prefix + path`)
- **ordenar por especificidade** antes de registrar: segmentos fixos antes de parâmetros (`/users/me` antes de `/users/:id`). Hono usa a primeira rota que casar na ordem de registro.
- lançar erro na inicialização para rota duplicada (mesmo verbo + path), indicando os dois controllers
- em rota com `auth`, chamar `authenticate` (e a função de `auth`, se houver) antes de instanciar o controller
- instanciar o controller por request e aplicar as regras de resposta
- responder 404 e 405 em JSON quando nenhuma rota casa (tabela "Respostas automáticas"), passando pelo `onError`
- `onError` central (tabela "Mapeamento de erros"), com hook do usuário antes do mapeamento padrão

### HttpContext

```ts
createContext(c: Context) => {
  request,                   // Request original (em runtime é o NextRequest passado pelo Next; tipado como Request)
  raw,                       // Context do Hono (escape hatch)
  auth,                      // AuthData; resultado do `authenticate` (undefined em rota sem auth)
  params,                    // Record<string, string>; com HttpContext<P>, objeto tipado pelo path
  query,                     // Record<string, string>
  headers,                   // Record<string, string>
  validate: {
    body(schema),            // Promise<z.infer<S>>; corpo JSON
    query(schema),           // z.infer<S>; query string
    params(schema),          // z.infer<S>; parâmetros do path
    headers(schema),         // z.infer<S>; headers (chaves em minúsculo)
  },
  response: {
    ok(data, init?),            // 200 JSON
    created(data, init?),       // 201 JSON
    noContent(init?),           // 204 sem corpo
    badRequest(message?, init?), // 400 { error }
    forbidden(message?, init?),  // 403 { error }
    notFound(message?, init?),   // 404 { error }
    redirect(url, status?),     // 302 por padrão; aceita 301, 303, 307, 308
    status(code, data?, init?), // qualquer status; data vira JSON
  },
}
export type HttpContext<P extends string = string> = ReturnType<typeof createContext<P>>;
```

`params` tipado pelo path:

- Genérico opcional: `HttpContext<"/:id/activate">` tipa `params` como `{ id: string }`. Sem genérico, `params` é `Record<string, string>`.
- Só os nomes importam: o path do genérico não é comparado com o `route` (pode ser o path relativo da action ou o completo, com params do `prefix`).
- Sintaxe do Hono: `/:id?` vira `{ id?: string }`; regex `/:id{[0-9]+}` vira `{ id: string }`.
- Path sem parâmetro (`HttpContext<"/me">`) tipa `params` como `{}`: acessar `params.id` é erro de compilação.
- Templates do `make:module` usam `HttpContext<"/:id">` em `show`, `update` e `destroy`.

`validate.*`:

- Todos fazem `schema.parse(...)` e lançam `ZodError` (→ 422 no handler central).
- Só `body` é assíncrono (lê o stream). `query`, `params` e `headers` são síncronos.
- Body JSON inválido/ausente vira `{}` antes do parse → Zod reporta 422.
- Valores de `query`, `params` e `headers` chegam como string: usar `z.coerce` para número/boolean.
- `query` com chave repetida (`?tag=a&tag=b`) entrega `string[]` para aquela chave; chave única entrega `string`.
- Uma origem por chamada; para validar body e query, duas chamadas.

`InferValidator` (só tipo):

```ts
export type InferValidator<T extends Record<string, z.ZodType>> = { [K in keyof T]: z.infer<T[K]> };
```

Tipa de uma vez um objeto de schemas. Padrão do `validator.ts` de cada módulo:

```ts
import type { InferValidator } from "nextroller";
import { z } from "zod";

const create = z.object({ name: z.string().min(1) });

export const validator = {
  create,
  update: create.partial(),
  list: z.object({ page: z.coerce.number().int().min(1).default(1) }),
};

export type Validated = InferValidator<typeof validator>;
```

- Controller usa `validator.create`; service tipa com `Validated["create"]`. Schema novo em `validator` ganha tipo sem editar mais nada.
- Schemas auxiliares (como `create`) ficam como `const` não exportado: escopo do módulo já os mantém privados.
- `Validated["list"]` é o tipo de saída do Zod (com `default` aplicado).

`response.*`:

- `init` é `{ headers?: HeadersInit }`. Headers extras e cookies vão por ele: `response.ok(data, { headers: { "Set-Cookie": "..." } })`. Vários cookies: passar `Headers` com `append`.
- Helpers de erro devolvem `{ error: message }`, o mesmo formato do handler central. Mensagens padrão em inglês: `"Bad request"` (400), `"Forbidden"` (403), `"Not found"` (404).
- Helpers **retornam** `Response`, não lançam. O controller faz `return response.forbidden()`. Para interromper de dentro de um service, lançar `HTTPException`.
- `redirect` aceita URL absoluta ou relativa e rejeita status fora de 301/302/303/307/308 (erro em runtime).

`request`:

- Mesma instância recebida pelo route handler (`c.req.raw`). Lib tipa como `Request` para não depender de `next`; usuário faz `request as NextRequest` se precisar de `nextUrl`/`cookies`.
- Body é stream de leitura única. Corpo JSON deve ser lido via `validate.body()` (usa cache de body do Hono). Ler `request.json()` direto consome o stream e quebra um `validate.body()` posterior. Usar `request` para metadados (`url`, `method`, `signal`) ou leituras não-JSON (`formData()`, stream).

### Autenticação

A lib não conhece token, sessão nem cookie. Ela só aplica a regra declarada no controller e delega a verificação ao `authenticate` do app.

```ts
class ProductsController {
  static route: Route<ProductsController> = {
    prefix: "/products",
    resource: true,
    auth: true,
    public: ["index", "show"],
  };

  async store({ auth, validate, response }: HttpContext) {
    const data = await validate.body(validator.create);
    return response.created(await this.products.create(auth.id, data));
  }
}

export const { GET, POST, PUT, PATCH, DELETE } = createHandler({
  controllers: [ProductsController],
  authenticate: async (request) => verifyToken(request.headers.get("authorization")),
});
```

Fluxo em rota protegida:

1. `authenticate(request)` roda antes de instanciar o controller. Pode ser síncrono ou assíncrono.
2. `null`/`undefined` → lança `UnauthorizedError` (401, `{ error: "Unauthorized" }`), que passa pelo `onError` como qualquer erro.
3. Se `route.auth` é função, ela roda com `(auth, route)`. Só `true` libera; qualquer outro retorno (`false`, `undefined`, valor truthy) lança `ForbiddenError` (403, `{ error: "Forbidden" }`).
4. O valor do `authenticate` vira `ctx.auth`.
5. Erro lançado dentro do `authenticate` ou da função de `auth` segue o mapeamento padrão (`HTTPException(402)` → 402; outros → 500).

`auth` como função (regra por controller):

```ts
import { defineController, type HttpContext, type Route } from "nextroller";

class OrdersController {
  static route: Route<OrdersController> = {
    prefix: "/orders",
    resource: true,
    auth: (auth, route) => route.method === "GET" || auth.role === "admin",
    public: ["index"],
    actions: { approve: ["POST", "/:id/approve"] },
  };
}
```

- `: Route<Controller>` tipa `auth` e `route` na função (`route.action` é a união dos métodos do controller). Com `as const`, usar `as const satisfies Route` ou anotar os parâmetros (`(auth: User, route: AuthRoute) => ...`); sem isso, os parâmetros viram `implicit any` (erro de compilação, nunca passa silencioso).
- `route` é `AuthRoute<Controller>`: `{ controller, action, method, path }`, montado na inicialização e congelado (`Object.freeze`). `path` é o padrão registrado, não a URL da request.
- Só `true` estrito libera (fail-closed): função que esquece o `return` nega acesso.
- Roda depois do `authenticate` (nunca com `auth` nulo) e antes de instanciar o controller. Ações em `public` não chamam nem `authenticate` nem a função.
- Para mensagem/status próprio, lançar `HTTPException` dentro da função em vez de devolver `false`.
- Regra que depende do recurso (dono do pedido, dados do banco) continua no service: a função só enxerga `auth` e a rota, não `params` nem body.

- Rotas sem `auth` e ações em `public` não chamam `authenticate` (rota pública não paga verificação de token). Nelas `ctx.auth` é `undefined`.
- Tipo de `ctx.auth` via declaration merging (chave `auth` do `Register`); sem registro, é `unknown`:
  ```ts
  declare module "nextroller" {
    interface Register {
      auth: User;
    }
  }
  ```
- `Register` é a única forma de tipar `ctx.auth`. Genérico no `HttpContext` (`HttpContext<P, User>`) foi descartado: cada controller afirmaria o tipo por conta própria, sem conferência com o retorno do `authenticate`. Com `Register`, o `createHandler` checa os dois lados.
- `ctx.auth` é tipado como não opcional mesmo em ação pública. Ler `auth` em ação pública é erro de lógica do controller.
- `ctx.auth` (dados resolvidos) e `route.auth` (regra do controller) têm o mesmo nome de propósito: um declara, o outro entrega.
- Autorização por role/rota: função em `route.auth`. Autorização que depende do recurso: service, lançando `HTTPException(403)`.
- `UnauthorizedError` e `ForbiddenError` estendem `HTTPException` e são exportados pela lib. `AuthGuard` e `AuthRoute` são exportados como tipos. Guard compartilhado entre controllers usa `AuthGuard` sem genérico (`route.action: string`) e é aceito em qualquer `Route<Controller>`.

### Respostas automáticas

Sem rota casando, o handler gera um erro e o trata como qualquer outro (fluxo de "Mapeamento de erros"). Resposta padrão em JSON (nunca o 404 padrão em texto do Hono):

| situação                                  | erro                          | status | corpo                              | header                     |
| ----------------------------------------- | ----------------------------- | ------ | ---------------------------------- | -------------------------- |
| nenhum path registrado casa               | `RouteNotFoundError`          | 404    | `{ error: "Route not found" }`     |                            |
| path casa, mas não com o verbo da request | `MethodNotAllowedError`       | 405    | `{ error: "Method not allowed" }`  | `Allow: GET, PUT, PATCH` (verbos registrados para o path) |

- Os dois estendem `HTTPException` e são exportados pela lib. `MethodNotAllowedError.allow` traz os verbos aceitos.
- Para decidir entre 404 e 405, o handler testa o path contra as rotas dos outros verbos. A lista é montada na inicialização, junto com a ordenação.
- Passam pelo `onError`: o hook pode customizar mensagem/formato (`if (err instanceof RouteNotFoundError) return ...`).
- No 405, se a `Response` final (padrão ou do hook) não tiver `Allow`, a lib adiciona.
- Não geram `console.error` (são `HTTPException`).

### Mapeamento de erros (`onError` em `createHandler()`)

Fluxo quando o controller (ou service) lança, quando `authenticate` lança ou não resolve usuário (401), ou quando nenhuma rota casa (404/405):

1. Se `createHandler` recebeu `onError`, ele é chamado com `(err, request)`.
2. Se o hook devolve `Response`, ela é a resposta final.
3. Se devolve `undefined`, segue para o mapeamento padrão:

| erro            | status       | corpo                                         |
| --------------- | ------------ | --------------------------------------------- |
| `z.ZodError`    | 422          | `{ error: "Validation failed", issues }`      |
| `HTTPException` | `err.status` | `{ error: err.message }`                      |
| outros          | 500          | `{ error: "Internal server error" }` + `console.error` |

- Uso típico do hook: log/Sentry (devolve `undefined`; filtrar `HTTPException` para não registrar 401/404/405) ou mapear erros de domínio (`if (err instanceof NotFoundError) return Response.json(..., { status: 404 })`).
- `console.error` do 500 padrão só roda quando não há `onError`. Com hook, o log é responsabilidade do usuário.
- Erro lançado dentro do próprio `onError` vira 500 padrão + `console.error` com os dois erros.
- Código do usuário sinaliza erros HTTP lançando `HTTPException`.

```ts
export const { GET, POST, PUT, PATCH, DELETE } = createHandler({
  controllers: [UsersController],
  onError(err, request) {
    if (err instanceof RouteNotFoundError) {
      return Response.json({ code: "ROUTE_NOT_FOUND", message: err.message }, { status: 404 });
    }
    if (!(err instanceof HTTPException)) {
      Sentry.captureException(err, { extra: { url: request.url } });
    }
    if (err instanceof NotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
  },
});
```

## Estrutura do app consumidor

Estrutura obrigatória (usada em `examples/next-app`, na documentação e no codegen). Toda a API vive em `app/api/`:

```
app/
  api/
    [[...path]]/
      route.ts                  # único route handler; chama createHandler
    modules/
      <modulo>/
        controller.ts           # class + static route + export default defineController(...)
        service.ts              # lógica de negócio
        validator.ts            # schemas Zod
```

Regras:

- **`app/api/` contém só duas coisas:** o catch-all `[[...path]]/route.ts` e a pasta `modules/`.
- **`modules/` fica em `app/api/modules/`.** Não na raiz do projeto, não dentro de `[[...path]]/`.
- Controller, service e validator de um recurso moram juntos em `app/api/modules/<modulo>/`. Nenhuma outra pasta é criada para eles.
- Nenhum arquivo de `modules/` vira rota no Next (no App Router só `route.ts`/`page.tsx` são roteáveis). Nunca criar `route.ts` dentro de `modules/`.
- Nome do módulo no plural, `snake_case` (`users`, `order_items`). O nome fica só na pasta: os arquivos se chamam sempre `controller.ts`, `service.ts` e `validator.ts`, sem prefixo.
- Os nomes das classes carregam o módulo (`UsersController`, `UsersService`), já que o arquivo não carrega.
- Dentro do módulo, imports relativos. Fora dele, alias `@/app/api/modules/...`.
- Módulo não importa controller de outro módulo. Reuso via service.
- Auth no app: `authenticate` passado no `route.ts`, delegando a um service (ex.: `UsersService.findByToken`). O `declare module "nextroller" { interface Register { auth: User } }` fica no service que define o tipo `User` (ex.: `users/service.ts`). Nenhuma pasta nova para auth.

`app/api/[[...path]]/route.ts`:

```ts
import { createHandler } from "nextroller";
import UsersController from "@/app/api/modules/users/controller";
import { UsersService } from "@/app/api/modules/users/service";

export const { GET, POST, PUT, PATCH, DELETE } = createHandler({
  basePath: "/api",
  prefix: "/v1",
  controllers: [UsersController],
  authenticate: async (request) =>
    new UsersService().findByToken(request.headers.get("authorization")),
});
```

`app/api/modules/users/controller.ts`:

```ts
import { defineController, type HttpContext, type Route } from "nextroller";
import { UsersService } from "./service";
import { validator } from "./validator";

class UsersController {
  static route: Route<UsersController> = {
    prefix: "/users",
    resource: true,
    auth: true,
    public: ["store"],
    actions: {
      me: ["GET", "/me"],
      activate: ["POST", "/:id/activate"],
      archive: [["PUT", "PATCH"], "/:id/archive"],
    },
  };

  constructor(private users = new UsersService()) {}

  async index({ validate }: HttpContext) {
    const { page } = validate.query(validator.list);
    return this.users.list(page);
  }

  async show({ params, response }: HttpContext<"/:id">) {
    const user = await this.users.find(params.id);
    return user ?? response.notFound("User not found");
  }

  async store({ validate, response }: HttpContext) {
    const data = await validate.body(validator.create);
    return response.created(await this.users.create(data));
  }

  async update({ params, validate }: HttpContext<"/:id">) {
    return this.users.update(params.id, await validate.body(validator.update));
  }

  async destroy({ params }: HttpContext<"/:id">) {
    await this.users.remove(params.id);
  }

  async me({ auth }: HttpContext) {
    return auth;
  }

  async activate({ params }: HttpContext<"/:id/activate">) {
    await this.users.activate(params.id);
  }

  async archive({ params }: HttpContext<"/:id/archive">) {
    await this.users.archive(params.id);
  }
}

export default defineController(UsersController);
```

`app/api/modules/users/validator.ts`:

```ts
import type { InferValidator } from "nextroller";
import { z } from "zod";

const create = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export const validator = {
  create,
  update: create.partial(),
  list: z.object({
    page: z.coerce.number().min(1).default(1),
  }),
};

export type Validated = InferValidator<typeof validator>;
```

## CLI

Bin `nextroller`, publicado no mesmo pacote (`"bin": { "nextroller": "./dist/cli/index.js" }`). O runtime (`src/index.ts`) nunca importa nada de `src/cli/`.

### `nextroller make:module <nome>`

```bash
npx nextroller make:module order_items
```

Gera:

```
app/api/modules/order_items/
  controller.ts
  service.ts
  validator.ts
```

Critérios:

- **Nome:** aceita `snake_case`, `kebab-case`, `camelCase` ou `PascalCase` e converte para `snake_case` (`orderItems` → `order_items`). Não pluraliza: o usuário já passa no plural. Nome vazio ou com caractere fora de `[a-zA-Z0-9_-]` é rejeitado.
- **Raiz:** procura `app/` e depois `src/app/` no diretório atual. Se não achar nenhum, aborta com erro.
- **Sem sobrescrever:** aborta se `app/api/modules/<nome>/` já existir. Não há `--force`.
- **Não edita `route.ts`.** Ao terminar, lista os arquivos criados e imprime o import e a entrada para adicionar a `controllers` (path do `route.ts` reflete `app/` ou `src/app/`):
  ```
  ✔ Module order_items created

    CREATE  app/api/modules/order_items/controller.ts
    CREATE  app/api/modules/order_items/service.ts
    CREATE  app/api/modules/order_items/validator.ts

  Next step: register the controller in app/api/[[...path]]/route.ts

      import OrderItemsController from "@/app/api/modules/order_items/controller";

      controllers: [..., OrderItemsController]
  ```
- **Nomes gerados:**
  - arquivos `controller.ts`, `service.ts` e `validator.ts` (sem prefixo; o módulo é a pasta);
  - classe `OrderItemsController` e serviço `OrderItemsService` (PascalCase do nome);
  - `prefix` `"/order-items"` (kebab-case do nome);
  - objeto `validator` com `create`, `update` e `list` e tipo `Validated = InferValidator<typeof validator>`, que o usuário estende à vontade.
- **Conteúdo dos templates:**
  - controller com `static route: Route<OrderItemsController> = { prefix, resource: true }`, os 5 métodos CRUD delegando ao service (`HttpContext<"/:id">` nos que leem `params.id`) e `export default defineController(...)`;
  - service com os métodos correspondentes lançando `new Error("Not implemented")`;
  - validator com `const create` privado e `validator = { create, update: create.partial(), list }` (paginado), mais `export type Validated = InferValidator<typeof validator>`; controller usa `validator.*` e service `Validated["create"]`/`Validated["update"]`.
- O código gerado compila sem ajustes e segue as convenções (aspas duplas, ponto e vírgula, imports relativos dentro do módulo).
- **Dependências:** `node:fs`, `node:path`, `chalk` (cores) e parse manual de `process.argv`. Nenhuma outra.
- **Erros e saída:** em inglês, coloridos com `chalk` (✔ verde no sucesso, `CREATE` verde, path do `route.ts` em ciano, `✖ Error:` vermelho em `stderr`). Exit code `1` em erro. `chalk` desliga cores sozinho fora de TTY (pipe, CI, testes), então o texto puro é o contrato testado.
- Comando desconhecido ou sem argumento imprime o uso (`Usage: nextroller make:module <name>` + exemplo) e sai com `1`.

## Em aberto

- **Descoberta automática de controllers:** script de codegen (e/ou plugin `withNextroller` no `next.config`) que varre `app/api/modules/*/controller.ts` e gera a lista passada a `controllers`. Seria açúcar opcional sobre a lista explícita. `require.context` e leitura do disco em runtime descartados (Turbopack / bundle serverless).
- **Checar `HttpContext<P>` contra o `route`:** hoje o genérico é declarado à mão e não é comparado com o path da action. Como `as const` preserva o path literal em `actions`, o `defineController` poderia rejeitar um método cujo `HttpContext<P>` declare params ausentes no path real (`prefix` + path da action).
- **`ctx.auth` opcional em ação pública:** hoje `auth` é tipado como não opcional em todas as ações. `defineController` poderia derivar por ação (`auth` menos `public`) e tipar `auth` como `undefined` nas públicas.
- **Listagem de rotas:** comando `nextroller routes` (no mesmo bin do `make:module`) imprimindo verbo, path, controller e se exige auth (e se tem regra customizada) (compensa a falta de visão central).

## Convenções de código

- TypeScript strict. ESM.
- Formatação: aspas duplas, ponto e vírgula.
- **Todas as mensagens em inglês por padrão:** respostas HTTP, erros de configuração, saída do CLI e código gerado pelos templates. Customização de texto fica com o usuário (`message` nos helpers, `onError`).

## Próximos passos

1. Setup do pacote (`package.json` com `exports`, build ESM + `.d.ts`, `zod` como peer).
2. Implementar `src/context.ts`, `src/controller.ts` e `src/handler.ts`.
3. Testes de tipo para `defineController` (casos que devem e não devem compilar) e checar legibilidade das mensagens de erro do TS.
4. Testes do handler chamando `GET/POST/...` com `Request` direto (sem subir Next): ordenação, conflitos, regras de resposta, helpers de `response`, 404/405 com `Allow` (inclusive via `onError`), `onError` (devolvendo `Response`, devolvendo `undefined`, lançando) e mapeamento padrão.
5. CLI `make:module`, com testes gerando em diretório temporário e checando se a saída compila (`tsc --noEmit`).
6. `examples/next-app` com o módulo `users`.
7. Autenticação: `auth`/`public` no `route`, `authenticate` no `createHandler`, `UnauthorizedError`, `ctx.auth` tipado por `Register`. Testes de tipo (`CheckPublic`, `Register`) e de handler (401 sem instanciar controller, ações públicas sem chamar `authenticate`, `authenticate` síncrono/assíncrono, erro dentro do `authenticate`, 401 via `onError`, `auth` sem `authenticate` falhando no boot).
8. `auth` como função: `AuthGuard`/`AuthRoute`, `ForbiddenError`, tipagem via `: Route<Controller>` (ou `as const satisfies Route`), com nomes de `actions`/`public` e `route.action` checados contra os métodos do controller. Testes de tipo (contexto via `satisfies`, `implicit any` sem ele, retorno não boolean, `auth` incompatível com `Register`) e de handler (`true` libera com `(auth, route)` congelado, `false`/truthy/`undefined` → 403 sem instanciar controller, função assíncrona, 401 antes da função, `public` sem chamar a função, 403 via `onError`, erro lançado na função).
