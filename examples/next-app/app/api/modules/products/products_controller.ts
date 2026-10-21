import { defineController, type HttpContext } from "nextroller";
import { ProductsService } from "./products_service";
import { createSchema, listSchema, updateSchema } from "./products_validator";

class ProductsController {
  static route = {
    prefix: "/products",
    resource: true,
  } as const;

  constructor(private products = new ProductsService()) {}

  async index({ validate }: HttpContext) {
    const { page } = validate.query(listSchema);
    return this.products.list(page);
  }

  async show({ params, response }: HttpContext) {
    const item = await this.products.find(params.id);
    return item ?? response.notFound();
  }

  async store({ validate, response }: HttpContext) {
    const data = await validate.body(createSchema);
    return response.created(await this.products.create(data));
  }

  async update({ params, validate }: HttpContext) {
    return this.products.update(params.id, await validate.body(updateSchema));
  }

  async destroy({ params }: HttpContext) {
    await this.products.remove(params.id);
  }
}

export default defineController(ProductsController);
