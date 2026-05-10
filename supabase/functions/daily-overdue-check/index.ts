import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async () => {
  const today      = new Date()
  const dayOfMonth = today.getDate()

  // Days 1–7: grace period — warn but don't suspend
  if (dayOfMonth <= 7) {
    return new Response(
      JSON.stringify({ message: 'Grace period (day 1–7), no suspensions.' }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    )
  }

  // First day of current month (YYYY-MM-DD)
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString().split('T')[0]
  const todayStr = today.toISOString().split('T')[0]

  // Find Active students with a batch assigned whose paid_till is before this month
  const { data: overdueStudents, error: fetchErr } = await supabase
    .from('students')
    .select('id, batch_id, batch, fees')
    .eq('status', 'Active')
    .not('batch_id', 'is', null)
    .or(`paid_till.is.null,paid_till.lt.${firstOfMonth}`)

  if (fetchErr) {
    return new Response(
      JSON.stringify({ error: fetchErr.message }),
      { headers: { 'Content-Type': 'application/json' }, status: 500 }
    )
  }

  if (!overdueStudents?.length) {
    return new Response(
      JSON.stringify({ suspended: 0, message: 'No overdue students.' }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    )
  }

  const suspendedIds: number[] = []

  for (const student of overdueStudents) {
    const { error: updateErr } = await supabase
      .from('students')
      .update({
        status:          'Suspended',
        last_batch_id:   student.batch_id,
        last_batch_name: student.batch,
        batch_id:        null,
        batch:           null,
        suspended_since: todayStr,
      })
      .eq('id', student.id)

    if (!updateErr) {
      suspendedIds.push(student.id)

      // Decrement batch enrolled count (floor at 0)
      if (student.batch_id) {
        const { data: batchRow } = await supabase
          .from('batches')
          .select('enrolled')
          .eq('id', student.batch_id)
          .single()

        if (batchRow && batchRow.enrolled > 0) {
          await supabase
            .from('batches')
            .update({ enrolled: batchRow.enrolled - 1 })
            .eq('id', student.batch_id)
        }
      }
    }
  }

  return new Response(
    JSON.stringify({ suspended: suspendedIds.length, ids: suspendedIds }),
    { headers: { 'Content-Type': 'application/json' }, status: 200 }
  )
})
