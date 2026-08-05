function Upload() {
  return (
    <div>
      <h1>Upload</h1>
      <form>
        <input type="file" accept="image/*" />
        <button type="submit">Upload</button>
      </form>
    </div>
  )
}

export default Upload