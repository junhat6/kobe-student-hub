import app from '../../worker/index';
export default {
  async fetch(r: Request, env: Env) {
    if (!(await fetch('https://pilot-readiness.invalid/')).ok)
      return new Response('', { status: 503 });
    return app.fetch(r, env);
  },
};
