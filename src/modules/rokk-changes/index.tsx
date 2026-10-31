// Lazy entry: App mounts this through React.lazy when the Changes view is
// first opened, so the view stays out of the startup bundle.
export { ChangesView as default } from "./ChangesView";
