import { route } from '../../server/router';
import type { Env } from '../../server/types';
export const onRequest: PagesFunction<Env> = context => route(context.request, context.env);
