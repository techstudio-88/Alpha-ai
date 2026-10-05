import { runLifecycle } from "../../lifecycle/process/route";
import {cronAuthorized} from '../../../../lib/cron-auth.mjs';
export async function GET(req){if(!cronAuthorized(req))return new Response("Unauthorized",{status:401});return runLifecycle()}
