import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

console.log('Testing Supabase Connection...')
console.log('URL:', supabaseUrl)
console.log('Anon Key Present:', !!supabaseAnonKey)
console.log('Service Key Present:', !!supabaseServiceKey)

async function testConnection() {
  try {
    // 1. Test Anon Client (Simulate Frontend)
    console.log('\n--- Testing Anon Client (Frontend) ---')
    const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey)
    
    // Try to fetch a public table (e.g., products)
    const { data: products, error: prodError } = await supabaseAnon
      .from('products')
      .select('id, name')
      .limit(1)
    
    if (prodError) {
      console.error('❌ Anon Client Error (Data Fetch):', prodError.message)
    } else {
      console.log('✅ Anon Client Data Fetch OK:', products.length > 0 ? 'Found data' : 'No data but connection OK')
    }

    // 2. Test Service Role Client (Simulate Backend Scripts)
    console.log('\n--- Testing Service Role Client (Backend) ---')
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey)
    
    const { data: users, error: userError } = await supabaseService.auth.admin.listUsers({ page: 1, perPage: 1 })
    
    if (userError) {
      console.error('❌ Service Client Error (Auth Admin):', userError.message)
    } else {
      console.log('✅ Service Client Auth Admin OK:', users.users.length >= 0 ? 'Connected' : 'Failed')
    }
    
    // 3. Test Storage Access (Images)
    console.log('\n--- Testing Storage Access ---')
    const { data: buckets, error: bucketError } = await supabaseService.storage.listBuckets()
    if (bucketError) {
        console.error('❌ Storage Error (List Buckets):', bucketError.message)
    } else {
        console.log('✅ Storage Buckets List OK:', buckets.map(b => b.name).join(', '))
        
        // Try to get a public URL for a file in 'card-images' if it exists
        const bucket = buckets.find(b => b.name === 'card-images' || b.name === 'images')
        if (bucket) {
            console.log(`   Found bucket: ${bucket.name}. Public: ${bucket.public}`)
            // Check bucket policy? (Hard via client, usually inferred by public access)
        } else {
            console.warn('   ⚠️ No obvious "card-images" or "images" bucket found.')
        }
    }

  } catch (err) {
    console.error('💥 Unexpected Error:', err)
  }
}

testConnection()
