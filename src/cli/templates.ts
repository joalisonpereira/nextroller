export interface ModuleNames {
  module: string;
  pascal: string;
  camel: string;
  kebab: string;
}

export function controllerTemplate({ pascal, camel, kebab }: ModuleNames): string {
  return `import { defineController, type HttpContext, type Route } from "nextroller";
import { ${pascal}Service } from "./service";
import { schemas } from "./validator";

class ${pascal}Controller {
  static route: Route<${pascal}Controller> = {
    prefix: "/${kebab}",
    resource: true,
  };

  constructor(private ${camel} = new ${pascal}Service()) {}

  async index({ validate }: HttpContext) {
    const { page } = validate.query(schemas.list);
    return this.${camel}.list(page);
  }

  async show({ params, response }: HttpContext<"/:id">) {
    const item = await this.${camel}.find(params.id);
    return item ?? response.notFound();
  }

  async store({ validate, response }: HttpContext) {
    const data = await validate.body(schemas.create);
    return response.created(await this.${camel}.create(data));
  }

  async update({ params, validate }: HttpContext<"/:id">) {
    return this.${camel}.update(params.id, await validate.body(schemas.update));
  }

  async destroy({ params }: HttpContext<"/:id">) {
    await this.${camel}.remove(params.id);
  }
}

export default defineController(${pascal}Controller);
`;
}

export function serviceTemplate({ pascal }: ModuleNames): string {
  return `import type { Input } from "./validator";

export class ${pascal}Service {
  async list(page: number): Promise<unknown[]> {
    throw new Error("Not implemented");
  }

  async find(id: string): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async create(data: Input["create"]): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async update(id: string, data: Input["update"]): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async remove(id: string): Promise<void> {
    throw new Error("Not implemented");
  }
}
`;
}

export function validatorTemplate(): string {
  return `import type { InferSchemas } from "nextroller";
import { z } from "zod";

const create = z.object({
  name: z.string().min(1),
});

export const schemas = {
  create,
  update: create.partial(),
  list: z.object({
    page: z.coerce.number().int().min(1).default(1),
  }),
};

export type Input = InferSchemas<typeof schemas>;
`;
}
