import { Link } from "react-router-dom";
import { useLoad } from "../../api/hooks";
import { Empty, Notice } from "../../components/Common";
export default function Dashboard() {
  const stock = useLoad("/products/low-stock");
  return (
    <>
      <div className="d-flex gap-2 mb-4">
        <Link className="btn btn-primary" to="sales">
          New sale
        </Link>
      </div>
      <section className="panel">
        <div className="d-flex justify-content-between mb-3">
          <h2 className="h6 mb-0">
            Stock needing attention{" "}
            {stock.data && "(" + stock.data.counts + ")"}
          </h2>
          <button
            className="btn btn-outline-secondary btn-sm"
            disabled={stock.loading}
            onClick={stock.reload}
          >
            Refresh
          </button>
        </div>
        <Notice error={stock.error} loading={stock.loading} />
        {stock.data?.Products.length > 0 ? (
          <div className="table-responsive">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Brand</th>
                  <th>Available stock</th>
                </tr>
              </thead>
              <tbody>
                {stock.data.Products.map((p) => (
                  <tr key={p._id}>
                    <td>{p.name}</td>
                    <td>{p.brand}</td>
                    <td className="text-warning">
                      {p.stockQuantity} {p.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          stock.data && <Empty>No products need restocking.</Empty>
        )}
      </section>
    </>
  );
}
