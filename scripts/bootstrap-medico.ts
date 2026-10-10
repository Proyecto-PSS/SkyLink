import { clerkClient } from '@clerk/nextjs/server'
import { PrismaClient } from '@prisma/client'

async function bootstrap() {
  const prisma = new PrismaClient()
  try {
    const users = await clerkClient().users.getUserList()
    if (users.data.length === 0) {
      console.log('No hay usuarios en Clerk. Registrate en localhost:3000/sign-in primero.')
      return
    }

    const firstUser = users.data[0]
    console.log(`Otorgando rol de MEDICO al usuario ${firstUser.id}...`)

    await clerkClient().users.updateUser(firstUser.id, {
      publicMetadata: { role: 'medico' }
    })

    await prisma.medico.upsert({
      where: { idMedico: firstUser.id },
      create: {
        idMedico: firstUser.id,
        nombre: firstUser.firstName || 'Usuario',
        apellido: firstUser.lastName || 'Prueba',
        especialidad: 'TRAUMATOLOGIA_ORTOPEDIA',
        matricula: 'MN-LOCAL-TEST',
        consultorio: 'Consultorio Virtual'
      },
      update: {
        nombre: firstUser.firstName || 'Usuario',
        apellido: firstUser.lastName || 'Prueba',
      }
    })

    console.log('✅ Listo! Ahora recargá localhost:3000/dashboard/medico/agenda y deberías poder entrar correctamente.')
  } catch (e) {
    console.error('Error durante el bootstrap:', e)
  } finally {
    await prisma.$disconnect()
  }
}

bootstrap()
