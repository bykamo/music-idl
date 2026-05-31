import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot as SlotPrimitive } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'cursor-pointer group whitespace-nowrap focus-visible:outline-none inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/90',
        outline: 'bg-background text-accent-foreground border border-input hover:bg-accent',
        ghost: 'text-accent-foreground hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        lg: 'h-10 rounded-md px-4 text-sm gap-1.5 [&_svg]:size-4',
        md: 'h-9 rounded-md px-3 gap-1.5 text-sm [&_svg]:size-4',
        sm: 'h-8 rounded-md px-2.5 gap-1.25 text-xs [&_svg]:size-3.5',
        icon: 'size-9 rounded-md [&_svg]:size-4 shrink-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? SlotPrimitive : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
