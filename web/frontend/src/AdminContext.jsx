import { createContext, useContext } from 'react'

export const AdminContext = createContext({ admin: null, setAdmin: () => {} })
export function useAdmin() { return useContext(AdminContext) }
