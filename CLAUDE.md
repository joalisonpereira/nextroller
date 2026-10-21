# nextroller

Biblioteca de controllers para o route handler do Next.js App Router.
Um único catch-all `app/api/[[...path]]/route.ts` delega todas as requests para a lib, que despacha para métodos de classes controller.
Rotas são declaradas no próprio controller, via propriedade estática `route`. Não existe arquivo de rotas.

Construída sobre Hono (motor de roteamento interno) e Zod (validação).

## O que a lib entrega

- `defineController(Classe)`: valida e tipa a config `static route` do controller
- `createHandler({ controllers, ... })`: registra controllers e devolve `{ GET, POST, PUT, PATCH, DELETE }` para exportar no `route.ts`
- controllers como classes com métodos (`index`, `show`, `store`, `update`, `destroy` + métodos livres)
- `HttpContext` simples (params, query, headers, validate, response helpers)
- validação com Zod dentro do controller
- tratamento central de erros

## Fora de escopo

Não adicionar sem pedido explícito:

- autenticação
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
  context.ts        # createContext, HttpContext
  controller.ts     # defineController, ControllerClass, RouteConfig, validação de route
  handler.ts        # createHandler: registro, ordenação, conflitos, onError
tests/              # testes da lib
examples/next-app/  # app Next de exemplo consumindo a lib
```

## Dependências

- `hono`: dependency. Detalhe de implementação, não vaza na API pública (exceto `ctx.raw` e `HTTPException`, reexportado pela lib).
- `zod`: **peerDependency**. Schemas do usuário e o `instanceof z.ZodError` do handler precisam usar a mesma cópia do zod.
- `next`: não é importado pela lib. `createHandler()` trabalha só com `Request` / `Response` da Web API.

## Princípios de design

- **Não brigar com o roteamento do Next.** Usuário cria um único `app/api/[[...path]]/route.ts`. Toda integração com o Next fica isolada em `createHandler()`.
- **Rotas moram no controller.** `static route` é a única fonte de verdade das rotas de um controller.
- **Tipagem em dois pontos.** `Route<T>` na anotação do `static route` checa conteúdo (verbos, paths, chaves de `actions`) na declaração. `defineController` exige a presença e o formato de `route` (TypeScript não exige membros `static` via `implements`), tipado contra `ControllerClass`.
- **Sem estado global.** Nenhum singleton na lib; cada `createHandler()` monta seu próprio app Hono.
- **`HttpContext` é objeto, não classe.** Permite desestruturar (`{ params, validate }`) sem perder `this`.
- **O retorno do controller define a resposta:**
  - objeto/valor → `200` JSON
  - `undefined` → `204` sem corpo
  - `Response` → retornado como está (gerado via `ctx.response.*`)
- **Controllers importados estaticamente e instanciados por request.** Sem import lazy (necessário para ler `static route`; no catch-all todos os controllers já estão no mesmo bundle). Sem estado compartilhado entre requests.
- **Dependência pesada via `import()` dentro do método**, nunca no topo do controller/service. Protege o cold start sem precisar de lazy no router.
- **DI via parâmetro default no construtor:** `constructor(private users = new UsersService()) {}`. Em teste, passar fake no construtor.
- **Controllers não usam try/catch para validação.** `ZodError` vira 422 no handler central.
- **Erros de configuração falham na inicialização**, não na request.
- **API pública pequena.** Cada export novo é contrato a manter.

## API pública

### `static route` + `defineController`

```ts
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Path = `/${string}`;
export type ActionDef = readonly [Method | readonly Method[], Path]; // ["GET", "/me"] ou [["PUT", "PATCH"], "/:id"]

// métodos públicos da instância
type Methods<T> = { [K in keyof T]: T[K] extends (...a: any[]) => any ? K : never }[keyof T] & string;

// tipo usado pelo usuário na anotação: static route: Route<UsersController> = { ... }
export interface Route<T> {
  readonly prefix: Path;                                       // prefixo de todas as rotas do controller
  readonly resource?: boolean;                                 // gera CRUD para index/show/store/update/destroy que existirem
  readonly actions?: { readonly [K in Methods<T>]?: ActionDef }; // { metodo: [verbo, path] }
}

// forma "apagada", usada internamente e no constraint
interface RouteConfig {
  readonly prefix: Path;
  readonly resource?: boolean;
  readonly actions?: { readonly [method: string]: ActionDef | undefined };
}

export interface ControllerClass {
  new (...args: any[]): object;
  readonly route: RouteConfig;
}

export function defineController<C extends ControllerClass>(controller: C): C;
```

Regras de `route`:

- **Declarar sempre com anotação genérica da própria classe:** `static route: Route<UsersController> = { ... }`. A anotação dá tipo contextual ao literal: tuplas e verbos são checados ali, e chave de `actions` que não é método público vira erro de excess property na própria declaração.
- Sem anotação, o TS alarga `["GET", "/me"]` para `string[]` e `"/users"` para `string`, e o `defineController` rejeita (erro de compilação). Esquecer a anotação nunca passa silenciosamente.
- `Route` sem genérico não é suportado: perderia a checagem das chaves de `actions`.
- `actions` sobrescreve `resource` quando o mesmo método aparece nos dois.
- Métodos `private` não podem ser rota (ficam fora de `keyof`). Helpers internos do controller devem ser `private`.
- Paths de `actions` são relativos ao `prefix`.

Onde cada erro é pego:

| erro                                                     | quando                                 |
| -------------------------------------------------------- | -------------------------------------- |
| `static route` ausente ou sem `prefix`                   | compile time (`defineController`)      |
| anotação `Route<...>` esquecida                          | compile time (`defineController`)      |
| chave de `actions` não é método público                  | compile time, na declaração (`Route<T>`) |
| verbo inválido (`["GT", "/me"]`), path sem `/` inicial   | compile time, na declaração (`Route<T>`) |
| rota duplicada entre controllers                         | runtime, no `createHandler`            |

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
}) => { GET, POST, PUT, PATCH, DELETE }
```

Responsabilidades:

- montar rotas de todos os controllers (`basePath + prefix + route.prefix + path`)
- **ordenar por especificidade** antes de registrar: segmentos fixos antes de parâmetros (`/users/me` antes de `/users/:id`). Hono usa a primeira rota que casar na ordem de registro.
- lançar erro na inicialização para rota duplicada (mesmo verbo + path), indicando os dois controllers
- instanciar o controller por request e aplicar as regras de resposta
- `onError` central (tabela abaixo)

### HttpContext

```ts
createContext(c: Context) => {
  request,                   // Request original (em runtime é o NextRequest passado pelo Next; tipado como Request)
  raw,                       // Context do Hono (escape hatch)
  params,                    // Record<string, string>
  query,                     // Record<string, string>
  headers,                   // Record<string, string>
  validate(schema, source?), // source: "body" (default) | "query" | "params"; retorna z.infer<S>; lança ZodError
  response: { ok, created, noContent, notFound, status },
}
export type HttpContext = ReturnType<typeof createContext>;
```

Body JSON inválido/ausente vira `{}` antes do parse → Zod reporta 422.

`request`:

- Mesma instância recebida pelo route handler (`c.req.raw`). Lib tipa como `Request` para não depender de `next`; usuário faz `request as NextRequest` se precisar de `nextUrl`/`cookies`.
- Body é stream de leitura única. Corpo JSON deve ser lido via `validate()` (usa cache de body do Hono). Ler `request.json()` direto consome o stream e quebra um `validate()` posterior. Usar `request` para metadados (`url`, `method`, `signal`) ou leituras não-JSON (`formData()`, stream).

### Mapeamento de erros (`onError` em `createHandler()`)

| erro            | status       | corpo                                         |
| --------------- | ------------ | --------------------------------------------- |
| `z.ZodError`    | 422          | `{ error: "Dados inválidos", issues }`        |
| `HTTPException` | `err.status` | `{ error: err.message }`                      |
| outros          | 500          | `{ error: "Erro interno" }` + `console.error` |

Código do usuário sinaliza erros HTTP lançando `HTTPException`.

## Estrutura do app consumidor

Estrutura obrigatória (usada em `examples/next-app`, na documentação e no codegen). Toda a API vive em `app/api/`:

```
app/
  api/
    [[...path]]/
      route.ts                  # único route handler; chama createHandler
    modules/
      <modulo>/
        <modulo>_controller.ts  # class + static route + export default defineController(...)
        <modulo>_service.ts     # lógica de negócio
        <modulo>_validator.ts   # schemas Zod
```

Regras:

- **`app/api/` contém só duas coisas:** o catch-all `[[...path]]/route.ts` e a pasta `modules/`.
- **`modules/` fica em `app/api/modules/`.** Não na raiz do projeto, não dentro de `[[...path]]/`.
- Controller, service e validator de um recurso moram juntos em `app/api/modules/<modulo>/`. Nenhuma outra pasta é criada para eles.
- Nenhum arquivo de `modules/` vira rota no Next (no App Router só `route.ts`/`page.tsx` são roteáveis). Nunca criar `route.ts` dentro de `modules/`.
- Nome do módulo no plural, `snake_case` (`users`, `order_items`). Arquivos prefixados com o nome do módulo.
- Dentro do módulo, imports relativos. Fora dele, alias `@/app/api/modules/...`.
- Módulo não importa controller de outro módulo. Reuso via service.

`app/api/[[...path]]/route.ts`:

```ts
import { createHandler } from "nextroller";
import UsersController from "@/app/api/modules/users/users_controller";

export const { GET, POST, PUT, PATCH, DELETE } = createHandler({
  basePath: "/api",
  prefix: "/v1",
  controllers: [UsersController],
});
```

`app/api/modules/users/users_controller.ts`:

```ts
import { defineController, type HttpContext, type Route } from "nextroller";
import { UsersService } from "./users_service";
import { createUser, updateUser, listUsers } from "./users_validator";

class UsersController {
  static route: Route<UsersController> = {
    prefix: "/users",
    resource: true,
    actions: {
      me: ["GET", "/me"],
      activate: ["POST", "/:id/activate"],
    },
  };

  constructor(private users = new UsersService()) {}

  async index({ validate }: HttpContext) {
    const { page } = await validate(listUsers, "query");
    return this.users.list(page);
  }

  async show({ params, response }: HttpContext) {
    const user = await this.users.find(params.id);
    return user ?? response.notFound("Usuário não encontrado");
  }

  async store({ validate, response }: HttpContext) {
    const data = await validate(createUser);
    return response.created(await this.users.create(data));
  }

  async update({ params, validate }: HttpContext) {
    return this.users.update(params.id, await validate(updateUser));
  }

  async destroy({ params }: HttpContext) {
    await this.users.remove(params.id);
  }

  async me({ headers }: HttpContext) {
    return this.users.findByToken(headers.authorization);
  }

  async activate({ params }: HttpContext) {
    await this.users.activate(params.id);
  }
}

export default defineController(UsersController);
```

`app/api/modules/users/users_validator.ts`:

```ts
import { z } from "zod";

export const createUser = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});
export const updateUser = createUser.partial();
export const listUsers = z.object({
  page: z.coerce.number().min(1).default(1),
});
```

## Em aberto

- **Descoberta automática de controllers:** script de codegen (e/ou plugin `withNextroller` no `next.config`) que varre `app/api/modules/*/*_controller.ts` e gera a lista passada a `controllers`. Seria açúcar opcional sobre a lista explícita. `require.context` e leitura do disco em runtime descartados (Turbopack / bundle serverless).
- **`params` tipado pelo path:** genérico opcional `HttpContext<"/:id/activate">` para tipar `params.id`. A anotação `Route<T>` não preserva o path literal, então inferir `params` a partir do `route` não é possível com esse modelo; o genérico em `HttpContext` seria manual.
- **Listagem de rotas:** comando `nextroller routes` imprimindo verbo, path e controller (compensa a falta de visão central).

## Convenções de código

- TypeScript strict. ESM.
- Formatação: aspas duplas, ponto e vírgula.
- Mensagens de erro padrão em pt-BR.

## Próximos passos

1. Setup do pacote (`package.json` com `exports`, build ESM + `.d.ts`, `zod` como peer).
2. Implementar `src/context.ts`, `src/controller.ts` e `src/handler.ts`.
3. Testes de tipo para `defineController` (casos que devem e não devem compilar) e checar legibilidade das mensagens de erro do TS.
4. Testes do handler chamando `GET/POST/...` com `Request` direto (sem subir Next): ordenação, conflitos, regras de resposta, mapeamento de erros.
5. `examples/next-app` com o módulo `users`.
