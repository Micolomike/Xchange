export default function StatCard({ title, value, icon, color = "indigo" }) {
    return (
      <div className={`rounded-xl shadow p-4 bg-${color}-50`}>
        <div className="flex items-center gap-4">
          <div className={`text-${color}-600 text-3xl`}>{icon}</div>
          <div>
            <p className="text-sm text-gray-500">{title}</p>
            <p className="text-xl font-bold text-${color}-700">{value}</p>
          </div>
        </div>
      </div>
    );
  }
  
