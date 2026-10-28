export function Messages({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
    </>
  );
}
