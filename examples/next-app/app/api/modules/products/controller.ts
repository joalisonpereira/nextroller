import { defineController, type HttpContext, type Route } from "nextroller";
import { ProductsService } from "./service";
import { schemas } from "./validator";

class ProductsController {
  static route: Route<ProductsController> = {
    prefix: "/products",
    resource: true,
    auth: (auth) => auth.active,
    public: ["index", "show"],
  };

  constructor(private products = new ProductsService()) {}

  async index({ validate }: HttpContext) {
    const { page } = validate.query(schemas.list);
    return this.products.list(page);
  }

  async show({ params, response }: HttpContext<"/:id">) {
    const item = await this.products.find(params.id);
    return item ?? response.notFound();
  }

  async store({ auth, validate, response }: HttpContext) {
    const data = await validate.body(schemas.create);
    return response.created(await this.products.create(auth.id, data));
  }

  async update({ params, validate }: HttpContext<"/:id">) {
    return this.products.update(
      params.id,
      await validate.body(schemas.update),
    );
  }

  async destroy({ params }: HttpContext<"/:id">) {
    await this.products.remove(params.id);
  }
}

export default defineController(ProductsController);
