import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';

/**
 * Component overrides applied to every MDX file. Typography itself comes from
 * the `.prose` class in globals.css; this is only about behaviour that plain
 * markdown cannot express.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    a: ({ href = '', children, ...props }) => {
      const isInternal = href.startsWith('/') || href.startsWith('#');
      if (isInternal) {
        return (
          <Link href={href} {...props}>
            {children}
          </Link>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
          {children}
        </a>
      );
    },
    // Tables can be wider than the column; let them scroll on their own.
    table: ({ children, ...props }) => (
      <div className="overflow-x-auto">
        <table {...props}>{children}</table>
      </div>
    ),
  };
}
