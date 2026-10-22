import { Auth, Controller, Public, type HttpContext } from "nextroller";
import { ProductsService } from "./service";
import { validator } from "./validator";

@Controller("/products", { resource: true })
export default class ProductsController {
  constructor(private service = new ProductsService()) {}

  async index({ validate }: HttpContext) {
    const { page } = validate.query(validator.list);
    return this.service.list(page);
  }

  async show({ params, response }: HttpContext<"/:id">) {
    const item = await this.service.find(params.id);
    return item ?? response.notFound();
  }

  async store({ auth, validate, response,request }: HttpContext) {
    const data = await validate.body(validator.create);
    return response.created(await this.service.create(auth.id, data));
  }

  async update({ params, validate }: HttpContext<"/:id">) {
    return this.service.update(
      params.id,
      await validate.body(validator.update),
    );
  }

  async destroy({ params }: HttpContext<"/:id">) {
    await this.service.remove(params.id);
  }
}
