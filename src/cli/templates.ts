export interface ModuleNames {
  module: string;
  pascal: string;
  camel: string;
  kebab: string;
}

export function controllerTemplate({ pascal, camel, kebab }: ModuleNames): string {
  return `import { Body, Controller, Ctx, NotFoundError, Param, Query, type HttpContext } from "nextroller";
import { ${pascal}Service } from "./service";
import { validator, type Validated } from "./validator";

@Controller("/${kebab}", { resource: true })
export default class ${pascal}Controller {
  constructor(private ${camel} = new ${pascal}Service()) {}

  async index(@Query(validator.list) { page }: Validated["list"]) {
    return this.${camel}.list(page);
  }

  async show(@Param("id") id: string) {
    const item = await this.${camel}.find(id);
    if (!item) throw new NotFoundError();
    return item;
  }

  async store(@Body(validator.create) data: Validated["create"], @Ctx() { response }: HttpContext) {
    return response.created(await this.${camel}.create(data));
  }

  async update(@Param("id") id: string, @Body(validator.update) data: Validated["update"]) {
    return this.${camel}.update(id, data);
  }

  async destroy(@Param("id") id: string) {
    await this.${camel}.remove(id);
  }
}
`;
}

export function serviceTemplate({ pascal }: ModuleNames): string {
  return `import type { Validated } from "./validator";

export class ${pascal}Service {
  async list(page: number): Promise<unknown[]> {
    throw new Error("Not implemented");
  }

  async find(id: string): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async create(data: Validated["create"]): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async update(id: string, data: Validated["update"]): Promise<unknown> {
    throw new Error("Not implemented");
  }

  async remove(id: string): Promise<void> {
    throw new Error("Not implemented");
  }
}
`;
}

export function validatorTemplate(): string {
  return `import type { InferValidator } from "nextroller";
import { z } from "zod";

const create = z.object({
  name: z.string().min(1),
});

export const validator = {
  create,
  update: create.partial(),
  list: z.object({
    page: z.coerce.number().int().min(1).default(1),
  }),
};

export type Validated = InferValidator<typeof validator>;
`;
}
